
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

  , RoomManager = require('./roomManager.js')
  , UserManager = require('./userManager.js');

/***** Db Creation *****/
var userDb = redis.createClient();

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
var getRoomFromHash = promisify(RoomManager.getRoomFromHash);

/**
 * Find config.users.cookie.name in cookie string and decrypt hash.
 * Returns false if invalid hash or {id, serverId, hashId} with hashId set to roomHash.
 * Note: Does not check if user exists!
 */
function getUserFromCookie(cookies, checkExists) {

	var def = deferred();


	var hashId = cookies.get(config.cookieId, { signed: true });
	if(typeof hashId === "undefined") def.resolve(false); 
	else {
		UserManager.getUserFromHash(hashId, checkExists, function(err, user) {
			if(!user) return def.reject(new restify.InvalidCredentialsError('Invalid user')); 

			def.resolve(_.extend(user, {hashId: hashId}));
		});
	}

	return def.promise;
}
/****** API ******/

/**
 * Mark that when getting the room object, it must also be checked that it exists in the db.
 */
function preRoomMustExist(req, res, next) {
	req.roomMustExist = true;
	next();
}

/**
 * Mark that when getting the user object, it must also be checked that it exists in the db.
 */
function preUserMustExist(req, res, next) {
	req.userMustExist = true;
	next();
}


/**
 * Get room from URL params. Optionally checking if the room does exist if 'preRoomMustExist' was called before.
 */
function preGetRoomObject(req, res, next) {
	getRoomFromHash(req.params.roomId, (req.roomMustExist ? req.roomMustExist : false))
	.then(function(room) {
		if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));
		room.hashId = req.params.roomId;
		req.room = room;
		return next();
	}).done();
}

/**
 * Get 
 */
function preGetUserFromCookie(req, res, next) {

	getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip), (req.userMustExist ? req.userMustExist : false))
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

	pRoomIsOwner(user.hashId)
	.then(function(isOwner) {

		if(isOwner) {
			pRoomDelete()
			.then(function(result) {

				user.deleteCurrentRoom(function(err, result) {
					if(err) {
						winston.log('error', 'Couldn\'t set users current room to null', err);
						return (new restify.InternalError('Couldn\'t leave room'));
					}
					//Kick all users and disconnect socket, socket.io should close down the room.
					io.sockets.clients(room.hashId).forEach(function (socket) { 
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
					user.getSocketId(callback);
				},

				setUsersCurrentRoom: function setCurrentRoom(callback) {
					user.deleteCurrentRoom(callback);
				},

				removeFromRoom: function removeUser(callback) {
					room.removeUser(user.hashId, callback);
				}
			}, function(err, results) {
				if(err) {
					winston.log('error', 'Couldn\'t remove room', err);
					return (new restify.InternalError('Couldn\'t leave room'));
				}

				var socket = io.sockets.socket(results.socketId);
				if(typeof socket !== 'undefined' && socket !== null) socket.leave(room.hashId);

				//Tell everyone the user left
				io.sockets.in(room.hashId).emit('user:disconnected', {
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
	var cookies = Cookies.fromHttp(req, res, userCookieKeygrip);

	if(user !== false) {

		UserManager.userExists(user.serverId, user.id, function(err, exists) {
			if(err) return next(new restify.BadMethodError('Already created user'));
			else if(exists) return next(new restify.BadMethodError('Already created user'));
			else {
				//Remove cookies and allow retry
				cookies.set(config.cookieId, '');
				cookies.set(config.cookieId +'.sig', '');
				res.setHeader('Location', '/api/users');
				res.json(300, {msg: 'Please retry'});
			}
		});
	} else {

		var name = req.body.name;

		if(!name || !name.length || name.length < 2 || name.length > 10) 
			return next(new restify.InvalidArgumentError('Name must be between 2 and 10 chars long'));

		var createUser = promisify(UserManager.create)


		createUser(name)
		.then(function(user){
			//Set the cookie of the userId hash. Signed so no tampering
			cookies.set(config.cookieId, user.hashId, { signed: true });
			//HTTP Created
			res.json(201, {
				id: user.hashId,
				name: name
			});
		}).done();
	}
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
server.post('/api/rooms', [preUserMustExist, preGetUserFromCookie, preIsUserValid], function(req, res, next) {
	
	var user = req.user;

	var pUsersGetCurrentRoom = _.bind(promisify(user.getCurrentRoom), user);
	var pRoomCreate = promisify(RoomManager.create);

	//If already in room
	pUsersGetCurrentRoom()
	.then(function(currentRoom) {
		if(currentRoom != null) {
			return (new restify.BadMethodError('Already in room.'));
		}
		//Owner id sent as hash
		return pRoomCreate(req.user.hashId);
	}).done(function(room) {
		res.json(201, {
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
server.get('/api/rooms/:roomId', [preUserMustExist, preGetUserFromCookie, preIsUserValid, preRoomMustExist, preGetRoomObject, preIsAllowedToUseRoom], function(req, res, next) {
	//Join the socket.io room if it exists. and send back the playlist
	var room = req.room;
	var user = req.user;

	async.parallel({

		playlist: function getPlaylist(callback) {
			room.getPlaylist(callback);
		},
		usersInRoom: function getUsers(callback) {
			room.getUsers(function(err, userHashes) {

				var calls = [];

				userHashes.forEach(function(userHash) {
					var userHashId = userHash;
					calls.push(function(forEachCallback) {
						UserManager.getUserFromHash(userHashId, false, function(err, user) {
							if(err) return forEachCallback(err);
							user.getName(function(err, name) {
								if(err) return forEachCallback(err);
								forEachCallback(null, {id: userHash, name: name});
							});
							
						});
						
					});
				});

				async.parallel(calls, callback);
			});
		},
		owner: function getOwner(callback) {
			room.getOwner(callback);
		},
		addUserToRoom: function addMeToList(callback) {
			if(!req.joinedRoom) room.addUser(user.hashId, callback);
			else callback(null, 1);
		},
		setUsersCurrentRoom: function setCurrentRoom(callback) {
			user.setCurrentRoom(room.hashId, callback);
		},
		username: function getUserName(callback) {
			user.getName(callback);
		},
		socketId: function getSocketIdForUser(callback) {
			user.getSocketId(callback);
		}
	}, function(err, results) {
		if(err) {
			//Clean up important details

			winston.log('error', 'Couldn\'t join room', err);

			room.removeUser(user.hashId, function() {});
			user.deleteCurrentRoom(function(err, result) {});

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
				
				socket.join(room.hashId);

				socket.broadcast.to(room.hashId).emit('user:joined', {
					user: {
						id: user.hashId,
						name: results.username
					}
				});
			}
		} else {
			//Tell everyone the user joined
			io.sockets.in(room.hashId).emit('user:joined', {
				user: {
					id: user.hashId,
					name: results.username
				}
			});
		}

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
server.post('/api/rooms/:roomId/next-song', [preUserMustExist, preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
	var user = req.user;
	var room = req.room;

	//If isOwner, block user and kick from room
	room.isOwner(user.hashId, function(err, isOwner) {
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
			io.sockets.in(room.hashId).emit('playlist:next-song', {
				
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

		res.json(200, {
			playlist: playlist
		});
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
server.post('/api/rooms/:roomId/playlist', [preUserMustExist, preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
	//Add song to redis playlist and broadcast change to all users
	var user = req.user;
	var room = req.room;

	if(!req.body.song) return next(new restify.MissingParameterError('No song given.'));

	var song = { owner: user.hashId };
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

			io.sockets.in(room.hashId).emit('playlist:song-added', {
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
server.del('/api/rooms/:roomId/playlist', [preUserMustExist, preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
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
			io.sockets.in(room.hashId).emit('playlist:song-removed', {
				songUid: songUid
			});

			res.json(200, {});
		});
	}

	room.getSongOwner(songUid, function(err, songOwnerId) {
		if(songOwnerId != user.hashId) {
			room.isOwner(user.hashId, function(err, isOwner) {
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
server.post('/api/rooms/:roomId/user/:userId/block', [preUserMustExist, preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
	var user = req.user;
	var room = req.room;

	var blockedUserIdHash = req.params.userId;
	/*
	//Check hash is valid, even thought we block the hashId not the decrypted values
	Users.IdGenerator.decryptHash(blockedUserIdHash, function(err, blockedUserDetails) {
		if(err) {
			winston.log('error', 'Couldn\'t decrypt user hash', err);
			return next(new restify.InternalError('Invalid user id to block'));
		}
		if(blockedUserDetails === false) return next(new restify.InvalidArgumentError('Invalid user'));

		var blockedUserId = blockedUserDetails.id;

		//If isOwner, block user and kick from room
		room.isOwner(user.hashId, function(err, isOwner) {
			if(err) {
				winston.log('error', 'Couldn\'t check owner of room', err);
				return next(new restify.InternalError('Couldn\'t check owner of room'));
			}
			if(!isOwner) return next(new restify.NotAuthorizedError('You don\'t have permission to block a user'));

			room.blockUser(blockedUserDetails.hashId, function(err, something) {
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
				io.sockets.in(room.hashId).emit('user:disconnected', {
					user: blockedUserDetails.hashId
				});

				res.json(200, {});
			});
		});
	});
*/
});

/** 
 * Owner unblocks a user
 * Body: {}
 * Returns: {}
 * Events: 
 */
server.post('/api/rooms/:roomId/user/:userId/unblock', [preUserMustExist, preGetUserFromCookie, preIsUserValid, preGetRoomObject], function(req, res, next) {
	var user = req.user;
	var room = req.room;

	var unblockedUserIdHash = req.params.userId;
	/*
	//Check hash id is valid
	Users.IdGenerator.decryptHash(blockedUserIdHash, function(err, blockedUserDetails) {
		if(err) {
			winston.log('error', 'Couldn\'t decrypt user hash', err);
			return next(new restify.InternalError('Invalid user id to unblock'));
		}
		if(blockedUserDetails === false) return next(new restify.InvalidArgumentError('Invalid user'));

		var blockedUserId = blockedUserDetails.id;

		//If isOwner, block user and kick from room
		room.isOwner(user.hashId, function(err, isOwner) {
			if(err) {
				winston.log('error', 'Couldn\'t check owner of room', err);
				return next(new restify.InternalError('Couldn\'t check owner of room'));
			}
			if(!isOwner) return next(new restify.NotAuthorizedError('You don\'t have permission to block a user'));

			room.unblockUser(blockedUserDetails.hashId, function(err, something) {
				if(err) {
					winston.log('error', 'Couldn\'t unblock user from room', err);
					return next(new restify.InternalError('Couldn\'t unblock user from room'));
				}

				res.json(200, {});
			});
		});
	});
*/
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

        var pGetUserFromHash = promisify(UserManager.getUserFromHash);

        pGetUserFromHash(userIdHash, true)
        .then(function(user) {
        	if(!user) {
        		accept('Invalid user id', false);
        		return;
        	}
        	//We don't bother holding the real object here, just needed details
        	data.user = {
    			hashId: userIdHash,
    			id: user.id,
    			serverId: user.serverId
    		};

    		// accept the incoming connection
	    	accept(null, true);

        }).done(function(result) {

        }, function(err) {
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
	var pGetUser = promisify(UserManager.getUser);

    pGetUser(socket.handshake.user.serverId, socket.handshake.user.id, true)
    .then(function(user) {
    	if(!user) {
    		socket.emit('error', {msg: 'Couldn\'t pair connection'});
    		return;
    	}
    	var pUserGetCurrentRoom = _.bind(promisify(user.getCurrentRoom), user);

    	pUserGetCurrentRoom()
    	.then(function(currentRoomId) {
    		if(currentRoomId) {
    			socket.join(currentRoomId)
    		}
    	}).done();

    	var pUserUpdateSocketId = _.bind(promisify(user.updateSocketId), user);
    	return pUserUpdateSocketId(socket.id);

    }).done(function() {

    }, function(err) {
    	socket.emit('error', {msg: 'Couldn\'t pair connection'});
    });


    socket.on('disconnect', function() {
    	//If is the owner of a room, give data and room grace period before kicking and closing

    	console.warn('Disconnected!!!!!!!!!!!!');
    	var pGetUser = promisify(UserManager.getUser);

    	var handshakeUser = socket.handshake.user;

    	pGetUser(handshakeUser.serverId, handshakeUser.id, true)
    	.then(function(user) {
    		if(!user) {
    		 	winston.log('error', 'Couldn\'t get user', err);
    			return;
    		}

    		var pUserGetCurrentRoom = _.bind(promisify(user.getCurrentRoom), user);

    		pUserGetCurrentRoom()
    		.then(function(currentRoomId) {
    			if(!currentRoomId) {
					winston.log('error', 'Couldn\'t get current room from user.id');
				} else {

					RoomManager.getRoomFromHash(currentRoomId, false, function(err, room) {
						if(err) {
							winston.log('error', 'Couldn\'t get room from hash on disconnect', err);
							return
						}
						user.hashId = handshakeUser.hashId;
						room.hashId = currentRoomId;
						leaveRoom(room, user, null);
					});
				}
    		}).done();
		}).done();
    	
    });
});

server.listen(config.server.port, function () {
    console.log('server listening at %s', server.url);
});




