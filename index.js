
/*

Socket.io with redis so multiple instances can be spawned.

API
------
-Connect to get SessionId and send Name
-Disconnect

-Create room returning RoomId
-Join RoomId if not part of other RoomId
-Leave RoomId

-Owner block SessionId
-Add SongId to room Playlist (server must confirm)
-Remove SongId from room Playlist (server must confirm request before song is removed)


Events
------
-User joined room
-User left room
-User blocked
-Current song changed
-New playlist item
-Playlist item removed


*/

var _ = require('underscore')
  , deferred = require('deferred')
  , promisify = require('deferred').promisify
  , async = require('async')
  , winston = require('winston')
  , config = require('config')

  , redis = require("redis")
  , restify = require('restify')
  , socketio = require('socket.io')
  , Keygrip = require("keygrip")
  , Cookies = require("./cookies.js")

  , Room = require('./room.js')
  , Users = require('./users.js');

/***** Db Creation *****/
var roomStore = redis.createClient();
var userDb = roomStore;

roomStore.on('error', function(err) {
	winston.log('errror', 'Redis client error', err);
});

var userCookieKeygrip = new Keygrip(config.users.cookie.keys);

/****** Server Setup *******/
var server = restify.createServer({name: config.server.name});
server.use(restify.fullResponse());
server.use(restify.queryParser());
server.use(restify.gzipResponse());
server.use(restify.bodyParser({ mapParams: false }));
//CORS setup
server.use(function(req, res, next) {
	if (req.headers.origin) {
		res.header('Access-Control-Allow-Origin', req.headers.origin);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', 'X-Requested-With, Cookie, Set-Cookie, Accept, Access-Control-Allow-Credentials, Origin, Content-Type, Request-Id , X-Api-Version, X-Request-Id');
    res.header('Access-Control-Expose-Headers', 'Set-Cookie');
    return next();
});
server.opts('.*', function(req, res, next) {
	if (req.headers.origin && req.headers['access-control-request-method']) {
		res.header('Access-Control-Allow-Origin', req.headers.origin);
		res.header('Access-Control-Allow-Credentials', 'true');
	 	res.header('Access-Control-Allow-Headers', 'X-Requested-With, Cookie, Set-Cookie, Accept, Access-Control-Allow-Credentials, Origin, Content-Type, Request-Id , X-Api-Version, X-Request-Id');
		res.header('Access-Control-Expose-Headers', 'Set-Cookie');
		res.header('Allow', req.headers['access-control-request-method']);
		res.header('Access-Control-Allow-Methods', req.headers['access-control-request-method']);
		if (req.log) {
			req.log.info({
	 			url: req.url,
				method: req.headers['access-control-request-method']
    		}, "Preflight");
		}
		res.send(204);
		return next();
	} else {
		res.send(404);
		return next();
	}
});

/****** Socket.io Setup *******/

var io = socketio.listen(server);
io.configure('production', function() {
	io.enable('browser client minification');  // send minified client
	io.enable('browser client etag');          // apply etag caching logic based on version number
	io.enable('browser client gzip');          // gzip the file
	io.set('log level', 1);                    // reduce logging
	io.set('transports', [                     // enable all transports (optional if you want flashsocket)
	    'websocket'
	    , 'flashsocket'
	    , 'htmlfile'
	    , 'xhr-polling'
	    , 'jsonp-polling'
	]);
	io.set("polling duration", 10); 
});

io.configure('development', function() { 
	io.enable('browser client gzip');          // gzip the file
	io.set('transports', [                     // enable all transports (optional if you want flashsocket)
	    'websocket'
	    , 'flashsocket'
	    , 'htmlfile'
	    , 'xhr-polling'
	    , 'jsonp-polling'
	]);
	io.set("polling duration", 10); 
});

/****** Helpers *******/



/**
 * Decrypt room hash.
 * Returns false if invalid hash or a Room() instance with hashId set to roomHash.
 * Note: Does not check if room exists!
 */
function getRoomFromHash(roomHash) {
	var def = deferred();

	Room.IdGenerator.decryptHash(roomHash, function(err, roomDetails) {
		if(!roomDetails) return def.reject(new restify.ResourceNotFoundError('Invalid room')); 

		var room = new Room(roomStore, roomDetails.id, roomDetails.serverId);
		def.resolve(_.extend(room, {hashId: roomHash}));
	});
	
	return def.promise;
}

/**
 * Find config.users.cookie.name in cookie string and decrypt hash.
 * Returns false if invalid hash or {id, serverId, hashId} with hashId set to roomHash.
 * Note: Does not check if user exists!
 */
function getUserFromCookie(cookies) {

	var def = deferred();


	var hashId = cookies.get(config.cookieId, { signed: true });
	if(typeof hashId === "undefined") def.resolve(false); 
	else {
		Users.IdGenerator.decryptHash(hashId, function(err, userDetails) {
			if(!userDetails) return def.reject(new restify.InvalidCredentialsError('Invalid user')); 

			def.resolve(_.extend(userDetails, {hashId: hashId}));
		});
	}

	return def.promise;
}
/****** API ******/


function preGetRoomObject(req, res, next) {
	getRoomFromHash(req.params.roomId)
	.then(function(room) {
		if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));
		req.room = room;
		return next();
	}).done();
}

function preGetUserFromCookie(req, res, next) {

	getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip))
	.then(function(user) {
		// Don't throw error because you can check if the user object exists if(user === false) return next(new restify.NotAuthorizedError());
		req.user = user;
		return next();
	}).done();
}

function preIsUserValid(req, res, next) {
	if(!req.user) return next(new restify.NotAuthorizedError());
	else return next();
}

function preUserExists(req, res, next) {
	next();
	//TODO
}


function preRoomExists(req, res, next) {
	if(!req.room) return next(new restify.ResourceNotFoundError('Room not found.'));
	if(!req.user) return next(new restify.NotAuthorizedError());

	var pRoomExists = promisify(Room.exists);

	pRoomExists(userDb, req.room.id)
	.then(function(exists) {
		if(exists == 1) {
			return next();
		} else {
			return next(new restify.ResourceNotFoundError('Room not found.'));
		}
	}).done();
}

function preIsAllowedToUseRoom(req, res, next) {
	if(!req.room) return next(new restify.ResourceNotFoundError('Room not found.'));

	var pHasUserJoined = _.bind(promisify(req.room.hasUserJoined), req.room);
	var pIsUserBlocked = _.bind(promisify(req.room.isUserBlocked), req.room);

	req.joinedRoom = false;

	pIsUserBlocked(req.user.id)
	.then(function(isBlocked) {

		if(isBlocked == 1) {
			return next(new restify.NotAuthorizedError('Not allowed to join this room.'));
		}
		pHasUserJoined(req.user.id)
		.then(function(hasJoined) {
			req.joinedRoom = hasJoined == 1;
			return next();
		});
	}).done(function() {

	}, function(err) {
		next(err);
	});
}

function leaveRoom(room, user, res) {
	var pRoomIsOwner = _.bind(promisify(room.isOwner), room);
	var pRoomDelete = _.bind(promisify(room.delete), room);

	pRoomIsOwner(user.id)
	.then(function(isOwner) {

		if(isOwner) {
			pRoomDelete()
			.then(function(result) {

				Users.deleteCurrentRoom(userDb, user.id, function(err, result) {
					if(err) {
						winston.log('error', 'Couldn\'t set users current room to null', err);
						return (new restify.InternalError('Couldn\'t leave room'));
					}
					//Kick all users and disconnect socket, socket.io should close down the room.
					io.sockets.clients(room.id).forEach(function (socket) { 
						socket.emit('room:closed', { expected: true });
						socket.disconnect();
					});

					if(res)
						res.json(200, {});
				});
			}).done();
		}else {
			async.series({
				socketId: function getSocketId(callback) {
					Users.getSocketId(userDb, user.id, callback);
				},

				setUsersCurrentRoom: function setCurrentRoom(callback) {
					Users.deleteCurrentRoom(userDb, user.id, callback);
				},

				removeFromRoom: function removeUser(callback) {
					room.removeUser(user.id, callback);
				}
			}, function(err, results) {
				if(err) {
					winston.log('error', 'Couldn\'t remove room', err);
					return (new restify.InternalError('Couldn\'t leave room'));
				}

				var socket = io.sockets.socket(results.socketId);
				if(typeof socket !== 'undefined' && socket !== null) socket.leave(room.id);

				//Tell everyone the user left
				io.sockets.in(room.id).emit('user:disconnected', {
					user: user.hashId
				});
				if(res)
					res.json(200, {});
			});
		}
	}).done();
}

/*

Most frequent
--------------
(1)add to playlist [Normal rate limit]
(3)=join room [Rate limit this massively!!!!]
(1)=get playlist [Normal rate limit]
(2)leave room [Rate limit this even more than usual!]
(3)create room [Rate limit this massively!!!!]
(5)remove from playlist [Rate limit this more than usual]
(2)block user [Rate limit this more than usual]
(5)create user [Rate limit more than everything else, 1 per 30 secs]

1 easiest effort
5 hardest effort
*/

/** 
 * Create a user
 * Body: {name: string}
 * Returns: {id: id, name: string}
 * Events: 
 */
server.post('/api/users', preGetUserFromCookie, function(req, res, next) {
	var user = req.user;
	if(user !== false) return next(new restify.BadMethodError('Already created user'));

	var name = req.body.name;

	if(!name || !name.length || name.length < 2 || name.length > 10) 
		return next(new restify.InvalidArgumentError('Name must be between 2 and 10 chars long'));

	var createUser = promisify(Users.create)


	createUser(userDb, name)
	.then(function(user){
		var cookies = Cookies.fromHttp(req, res, userCookieKeygrip);
		//Set the cookie of the userId hash. Signed so no tampering
		cookies.set(config.cookieId, user.hashId, { signed: true });

		res.json(200, {
			id: user.hashId,
			name: name
		});
	}).done();
});

/**
 * Don't respond with any rooms.
 */
server.get('/api/rooms', function(req, res, next) {
	res.json(200, {msg:'You wont see any here'});
});


/**
 * Create a room returning back the room id.
 * Body: {}
 * Returns {room: id}
 * Events: 
 */
server.post('/api/rooms', [preGetUserFromCookie, preIsUserValid], function(req, res, next) {
	
	var pUsersGetCurrentRoom = promisify(Users.getCurrentRoom);
	var pRoomCreate = promisify(Room.create);

	//If already in room
	pUsersGetCurrentRoom(userDb, req.user.id)
	.then(function(currentRoom) {
		if(currentRoom != null) {
			return (new restify.BadMethodError('Already in room.'));
		}
		return pRoomCreate(roomStore, req.user.id);
	}).done(function(room) {
		res.json(200, {
			room: room.hashId
		});
	}, function(err) {
		winston.log('error', 'Failed to create room', err);
		return next(new restify.InternalError('Failed to create room.'));
	});
});

/**
 * Joins a room. Must join a room after you create a room too.
 * Body: {}
 * Returns: {id: id, playlist: [{},{}], users: [{},{}]}
 * Events: user:joined {user: id, name: string}
 */
server.get('/api/rooms/:roomId', [preGetUserFromCookie, preIsUserValid, preGetRoomObject, preRoomExists, preIsAllowedToUseRoom], function(req, res, next) {
	//Join the socket.io room if it exists. and send back the playlist
	var room = req.room;
	var user = req.user;

	//var pParallel = promisify(async.parallel);

	var pGetPlaylist = _.bind(promisify(room.getPlaylist), room);
	var pUserIdGeneratorEncrypt = _.bind(promisify(Users.IdGenerator.encryptId), Users.IdGenerator);

	var pGetUsers = _.bind(promisify(room.getUsers), room);
	var pUsersGetSantisedUsers = promisify(Users.getSantisedUsers);

	var pGetOwner = _.bind(promisify(room.getOwner), room);

	async.parallel({

		playlist: function getPlaylist(callback) {

			pGetPlaylist()
			.then(function(playlist) {

				//Santitise owner ids
				if(!playlist || playlist.length == 0) {
					return callback(null, []);
				}
				for(var i = 0; i < playlist.length; i++){
					(function(index) {

						pUserIdGeneratorEncrypt({ serverId: config.db.users.id, id: parseInt(playlist[index].owner) })
						.then(function(ownerHash) {
							playlist[index].owner = ownerHash;
							
						}).done(
						function(result) {
							//Send the completed callback
							if(index === playlist.length -1) callback(null, playlist);
						});
					})(i);
				}
			}).done(function(result) {
				//TODO not sure if i can call callback() here because it may get executed before the above loop finishes
			}, function(err) {
				callback(err);
			});
		},
		usersInRoom: function getUsers(callback) {

			pGetUsers()
			.then(function(users) {
				return pUsersGetSantisedUsers(userDb, users);
			}).done(function(sanitisedUsers) {
				callback(null, sanitisedUsers);
			}, function(err) {
				callback(err);
			});
		},
		owner: function getOwner(callback) {

			pGetOwner()
			.then(function(owner) {
				//Get owner id hash
				return pUserIdGeneratorEncrypt({ serverId: config.db.users.id, id: parseInt(owner) });
			}).done(function(owner) {
				callback(null, owner);
			},
			function(err) {
				callback(err);
			});
		},
		addUserToRoom: function addMeToList(callback) {
			if(!req.joinedRoom) room.addUser(user.id, callback);
			else callback(null, 1);
		},
		setUsersCurrentRoom: function setCurrentRoom(callback) {
			Users.setCurrentRoom(userDb, user.id, room.id, callback);
		},
		username: function getUserName(callback) {
			Users.getName(userDb, user.id, callback);
		},
		socketId: function getSocketIdForUser(callback) {
			Users.getSocketId(userDb, user.id, callback);
		}
	}, function(err, results) {
		if(err) {
			//Clean up important details

			winston.log('error', 'Couldn\'t join room', err);

			room.removeUser(user.id, function() {});
			Users.deleteCurrentRoom(userDb, user.id, function() {});

			return next(new restify.InternalError('Couldn\'t join room'));
		}

		if(results.socketId != -1 ) {
			var socket = io.sockets.socket(results.socketId);

			//If they have made a socket.io connection then check if they are in any rooms and join the specific room.
			if(typeof socket !== 'undefined' && socket !== null) {

				//Check if they are in any rooms already
				var currentRooms = io.sockets.manager.roomClients[socket.id];
				if(typeof currentRooms !== 'undefined' && currentRooms !== null && currentRooms.length > 1) {
					return (new restify.InvalidArgumentError('Already joined a room.'));
				}
				
				socket.join(room.id);
			}
		}


		//Tell everyone the user joined
		io.sockets.in(room.id).emit('user:joined', {
			user: {
				id: user.hashId,
				name: results.username
			}
		});

		res.json(200, {
			id: room.hashId, 
			owner: results.owner,
			playlist: results.playlist, 
			users: results.usersInRoom
		});
	});
});

/**
 * Inform user you have left, if it is the owner, kick everyone
 * Note: retries 3 times since this is heavily rate limited
 * Body: {}
 * Returns: {}
 * Events user:disconnected {user: id}, room:closed {expected: bool}
 */
server.post('/api/rooms/:roomId/leave', [preGetUserFromCookie, preIsUserValid, preGetRoomObject, preIsAllowedToUseRoom], function(req, res, next) {
	//Leave the socket.io room. Can happen just by disconnecting socket.io connection!
	var room = req.room;
	var user = req.user;
	if(!req.joinedRoom) {
		res.json(200, {});
		return;
	}

	leaveRoom(room, user, res);
});

/** 
 * Owner informs everyone to show the next song is playing.
 * Body: {}
 * Returns: {}
 * Events: playlist:next-song {}
 */
server.post('/api/rooms/:roomId/next-song', [preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
	var user = req.user;
	var room = req.room;

	//If isOwner, block user and kick from room
	room.isOwner(user.id, function(err, isOwner) {
		if(err) {
			winston.log('error', 'Couldn\'t check owner of room', err);
			return next(new restify.InternalError('Couldn\'t check owner of room'));
		}
		if(!isOwner) return next(new restify.NotAuthorizedError('You don\'t have permission to select next song'));

		room.popCurrentSongOffPlaylist(function(err, something) {
			if(err) {
				if(err === 'playlist-empty') {
					return next(new restify.BadMethodError('Playlist empty'));
				}
				return next(new restify.InternalError('Couldn\'t update playlist'));
			}

			//Tell everyone its the next song
			io.sockets.in(room.id).emit('playlist:next-song', {
				
			});
			res.json(200, {});
		});
	});
});

/** 
 * Get the playlist.
 * Body: {}
 * Returns: {playlist: [{},{}]}
 * Events: 
 */
server.get('/api/rooms/:roomId/playlist', preGetRoomObject, function(req, res, next) {
	var room = req.room;

	room.getPlaylist(function(err, playlist) {
		if(err) {
			winston.log('error', 'Failed to get playlist', err);
			return next(new restify.InternalError('Failed to get playlist.'));
		}

		//Santitise owner ids
		for(var i = 0; i < playlist.length; i++){
			(function(index) {
				Users.IdGenerator.encrypt({ serverId: config.db.users.id, id: parseInt(playlist[index].owner) }, function(err, ownerHash) {
					playlist[index].owner = ownerHash;

					//Send the completed callback
					if(index === playlist.length -1) {
						res.json(200, {
							playlist: playlist
						})
					}
				});

			});
		}
	});
});

/** 
 * Add song to playlist
 * Body: {
	song: {
		yt: Youtube id 
		OR
		id, title, arist, album, length
	}
 }
 * Returns: {song: {}}
 * Events: playlist:song-added {song: {}}
 */
server.post('/api/rooms/:roomId/playlist', [preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
	//Add song to redis playlist and broadcast change to all users
	var user = req.user;
	var room = req.room;

	if(!req.body.song) return next(new restify.MissingParameterError('No song given.'));

	var song = { owner: user.id };
	if(req.body.song.yt) {
		song.id = req.body.song.yt;
		song.isYt = true;
	} else {
		//Song from their library
		song.id = req.body.song.id;
		song.title = req.body.song.title;
		song.artist = req.body.song.artist;
		song.album = req.body.song.album;
		song.length = req.body.song.length;
	}

	room.getUniquePlaylistId(function(err, songUid) {
		if(err) {
			winston.log('error', 'Couldn\'t add song to playlist', err);
			return next(new restify.InternalError('Couldn\'t add song to playlist'));
		}

		song.uid = songUid;

		room.addToPlaylist(song, function (err, stepsSuccess) {
			if(err) {
				winston.log('error', 'Couldn\'t add song to playlist', err);
				return next(new restify.InternalError('Couldn\'t add song to playlist'));
			}

			//Sanitize the object
			song.owner = user.hashId;

			io.sockets.in(room.id).emit('playlist:song-added', {
				song: song
			});

			res.json(200, {
				song: song
			});
		});
	});
});

/** 
 * Remove song from playlist
 * Body: {songIndex: index}
 * Returns: {}
 * Events: playlist:song-removed {songIndex: index}
 */
server.del('/api/rooms/:roomId/playlist', [preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
	//If isOwner, remove song from redis playlist and broadcast change to all users
	var user = req.user;
	var room = req.room;

	if(!req.body.songUid) return next(new restify.MissingParameterError('No song uid given.'));
	var songUid = req.body.songUid;

	function removeSong() {

		room.removeFromPlaylist(songUid, function(err, something) {
			if(err) {
				winston.log('error', 'Couldn\'t remove song from playlist', err);
				return next(new restify.InternalError('Couldn\'t remove song from playlist'));
			}
			io.sockets.in(room.id).emit('playlist:song-removed', {
				songUid: songUid
			});

			res.json(200, {});
		});
	}

	room.getSongOwner(songUid, function(err, songOwnerId) {
		if(songOwnerId != user.id) {
			room.isOwner(user.id, function(err, isOwner) {
				if(err) {
					winston.log('error', 'Couldn\'t check owner of song', err);
					return next(new restify.InternalError('Couldn\'t check owner of song'));
				}
				if(!isOwner) return next(new restify.NotAuthorizedError('You don\'t have permission to remove this song'));

				removeSong();
			});
		} else {
			removeSong();
		}
	});
});

/** 
 * Owner blocks a user
 * Body: {}
 * Returns: {}
 * Events: user:disconnected {user: id}
 */
server.post('/api/rooms/:roomId/user/:userId/block', [preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
	var user = req.user;
	var room = req.room;

	var blockedUserIdHash = req.params.userId;
	
	var blockedUserDetails = Users.IdGenerator.decryptHash(blockedUserIdHash, function(err, blockedUserDetails) {
		if(err) {
			winston.log('error', 'Couldn\'t decrypt user hash', err);
			return next(new restify.InternalError('Couldn\'t decrypt user hash'));
		}
		if(blockedUserDetails === false) return next(new restify.InvalidArgumentError('Invalid user'));

		var blockedUserId = blockedUserDetails.id;

		//If isOwner, block user and kick from room
		room.isOwner(user.id, function(err, isOwner) {
			if(err) {
				winston.log('error', 'Couldn\'t check owner of room', err);
				return next(new restify.InternalError('Couldn\'t check owner of room'));
			}
			if(!isOwner) return next(new restify.NotAuthorizedError('You don\'t have permission to block a user'));

			room.blockUser(blockedUserId, function(err, something) {
				if(err) {
					winston.log('error', 'Couldn\'t block user from room', err);
					return next(new restify.InternalError('Couldn\'t block user from room'));
				}

				//Send kick to specific user socket
				Users.getSocketId(userDb, user.id, function(err, socketId) {
					if(err) {
						winston.log('error', 'Couldn\'t kick the user', err);
						return next(new restify.InternalError('Couldn\'t kick the user'));
					}

					var socket = io.sockets.socket(socketId);
					if(typeof socket !== 'undefined' && socket !== null) socket.disconnect();
				});

				//Tell everyone the user left
				io.sockets.in(room.id).emit('user:disconnected', {
					user: blockedUserDetails.hashId
				});

				res.json(200, {});
			});
		});
	});
});

/** 
 * Owner unblocks a user
 * Body: {}
 * Returns: {}
 * Events: 
 */
server.post('/api/rooms/:roomId/user/:userId/unblock', [preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
	var user = req.user;
	var room = req.room;

	var unblockedUserIdHash = req.params.userId;
	
	var blockedUserDetails = Users.IdGenerator.decryptHash(blockedUserIdHash, function(err, blockedUserDetails) {
		if(err) {
			winston.log('error', 'Couldn\'t decrypt user hash', err);
			return next(new restify.InternalError('Couldn\'t decrypt user hash'));
		}
		if(blockedUserDetails === false) return next(new restify.InvalidArgumentError('Invalid user'));

		var blockedUserId = blockedUserDetails.id;

		//If isOwner, block user and kick from room
		room.isOwner(user.id, function(err, isOwner) {
			if(err) {
				winston.log('error', 'Couldn\'t check owner of room', err);
				return next(new restify.InternalError('Couldn\'t check owner of room'));
			}
			if(!isOwner) return next(new restify.NotAuthorizedError('You don\'t have permission to block a user'));

			room.unblockUser(unblockedUserId, function(err, something) {
				if(err) {
					winston.log('error', 'Couldn\'t unblock user from room', err);
					return next(new restify.InternalError('Couldn\'t unblock user from room'));
				}

				res.json(200, {});
			});
		});
	});
});

/**
 * Serve out the static html.
 */
server.get(/^\/.*/, restify.serveStatic({
	directory: './public'
}));

/****** Socket.io ******/

io.set('authorization', function (data, accept) {
    // check if there's a cookie header
    if (data.headers.cookie) {
        // if there is, parse the cookie
        var cookies = Cookies.fromHeaderString(data.headers.cookie, userCookieKeygrip);

        var userIdHash = cookies.get(config.cookieId, { signed: true});
        if(typeof userIdHash === "undefined") return accept('Cookies must be enabled', false);


        var defDecryptHash = _.bind(promisify(Users.IdGenerator.decryptHash), Users.IdGenerator);

        defDecryptHash(userIdHash)
        .then(function(userDetails) {
        	if(userDetails === false) return accept('Invalid user id', false);

        	return promisify(Users.exists)(userDb, userDetails.id)
        	.then(function(exists) {
        		if(exists !== 1) return accept('Invalid user id', false);

        		data.user = {
        			idHash: userIdHash,
        			id: userDetails.id,
        			serverId: userDetails.serverId
        		};

				// accept the incoming connection
	    		accept(null, true);
        	});

        }).done(function(result) {
        	
        },
        function(err) {
        	winston.log('error', 'Couldn\'t authorize socket', err);
        	accept('error', false);
        });
        
    } else {
       // if there isn't, turn down the connection with a message
       // and leave the function.
       return accept('Cookies must be enabled', false);
    }
    
});

io.sockets.on('connection', function (socket) {

	//Attach socket id to userObject in redis for sending specific kick message
	Users.updateSocketId(userDb, socket.handshake.userId, socket.id, function(err, something) {
		if(err) {
			socket.emit('error', {msg: 'Couldn\'t pair connection'});
			socket.disconnect();
		}
	});

    socket.on('disconnect', function() {
    	//If is the owner of a room, give data and room grace period before kicking and closing
    	Users.updateSocketId(userDb, socket.handshake.userId, null, function(err, something) {});

    	console.warn('Disconnected!!!!!!!!!!!!');

    	//TODO Change server to store encrypted idds wherever possible

    	var user = socket.handshake.user;
    	Users.getCurrentRoom(userDb, user.id, function(err, currentRoomId){ 
			if(err || !currentRoomId) {

			}

			//TODO fix
			var room = new Room(roomStore, currentRoomId, config.db.rooms.id);
			leaveRoom(room, user, null);
		});

    	
    });
});

server.listen(config.server.port, function () {
    console.log('server listening at %s', server.url);
});




