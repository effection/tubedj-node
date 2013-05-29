
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
  , async = require('async')
  , winston = require('winston')
  , config = require('config')

  , redis = require("redis")
  , restify = require('restify')
  , socketio = require('socket.io')
  , Keygrip = require("keygrip")
  , Cookies = require("./cookies.js")
  , Hashids = require('hashids')
  , hashids = new Hashids('TODO ADD SALT', 8)

  , IdGenerator = require('./IdGenerator.js')
  , Room = require('./room.js')
  , Users = require('./users.js');

/***** Db Creation *****/
var roomStore = redis.createClient();
var userDb = roomStore;

roomStore.on('error', function(err) {
	winston.log('errror', 'Redis client error', err);
});

var RoomIdGenerator = IdGenerator.createFromConfig(config.rooms.idLength, config.rooms.idKey, config.rooms.cacheIds);
var UserIdGenerator = IdGenerator.createFromConfig(config.users.idLength, config.users.idKey, config.users.cacheIds);

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
}

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
}

/****** Helpers *******/

/**
 * Decrypt room hash.
 * Returns false if invalid hash or a Room() instance with hashId set to roomHash.
 * Note: Does not check if room exists!
 */
function getRoomFromHash(roomHash) {
	var roomDetails = RoomIdGenerator.decryptHash(roomHash);
	if(!roomDetails) return false;

	var room = new Room(roomStore, roomDetails.id);//TODO pass server id to Room()
	return _.extend(room, {hashId: roomHash});
}

/**
 * Find config.users.cookie.name in cookie string and decrypt hash.
 * Returns false if invalid hash or {id, serverId, hashId} with hashId set to roomHash.
 * Note: Does not check if user exists!
 */
function getUserFromCookie(cookies) {

	var hashId = cookies.get(config.cookieId, { signed: true });
	if(typeof hashId === "undefined") return false;

	var userDetails = UserIdGenerator.decryptHash(hashId);
	if(!userDetails) return false;

	return _.extend(userDetails, {hashId: hashId});
}

/****** API ******/

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
server.post('/api/users', function(req, res, next) {
	//Assign an Id to the user if one is not passed, never expires
	var cookies = Cookies.fromHttp(req, res, keygrip);

	var user = getUserFromCookie(cookies);
	if(user !== false) return next(new restify.BadMethodError(''));

	var name = req.body.name;

	if(!name || !name.length || name.length < 2 || name.length > 10) {
		return next(new restify.InvalidArgumentError('Name must be between 2 and 10 chars long'));
	}

	Users.create(userDb, name, function(err, userId) {
		if(err) {
			winston.log('error', 'Failed to create user', err);
			return next(new restify.InternalError('Failed to create user.'));
		}

		//Set the cookie of the userId hash. Signed so no tampering
		var userHash = hashids.encrypt(config.userDbServerId, userId);
		cookies.set(config.cookieId, userHash, { signed: true });

		res.json(200, {
			id: userHash,
			name: name
		});
	});
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
server.post('/api/rooms', function(req, res, next) {
	//Create a room setting its owner id and returning the room id

	var user = getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip));
	if(user === false) return next(new restify.NotAuthorizedError());

	Room.create(roomStore, user.id, function(err, room) {
		if(err) {
			winston.log('error', 'Failed to create room', err);
			return next(new restify.InternalError('Failed to create room.'));
		}

		var roomHash = hashids.encrypt(config.redisServerId, room.id);

		res.json(200, {
			room: roomHash
		});
	});
});

/**
 * Joins a room. Must join a room after you create a room too.
 * Body: {}
 * Returns: {room: id, playlist: [{},{}], users: [{},{}]}
 * Events: user:joined {user: id, name: string}
 */
server.get('/api/rooms/:roomId', function(req, res, next) {
	//Join the socket.io room if it exists. and send back the playlist

	var user = getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip));
	if(user === false) return next(new restify.NotAuthorizedError());

	var room = getRoomFromHash(req.params.roomId);
	if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));

	Room.exists(roomStore, room.id, function(err, roomExists) {
		if(!roomExists) return next(new restify.ResourceNotFoundError('Room not found.'));

		room.hasUserJoined(user.id, function(err, userHasJoinedAlready) {
			//if(userHasJoinedAlready) return next(new restify.BadMethodError('Already joined this room'));

			room.isUserBlocked(room.id, function(err, isBlocked) {
				if(isBlocked) return next(new restify.NotAuthorizedError('Blocked from room'));

				async.parallel({
					playlist: function getPlaylist(callback) {
						room.getPlaylist(callback);
					},
					usersInRoom: function getUsers(callback) {
						room.getUsers(function(err, users) {
							Users.getSantisedUsers(userDb, users, callback)
						});
					},
					owner: function getOwner(callback) {
						room.getOwner(callback);
					},
					addUserToRoom: function addMeToList(callback) {
						if(!userHasJoinedAlready) room.addUser(user.id, callback);
						else callback(null, 1);
					},
					username: function getUserName(callback) {
						Users.getName(userDb, user.id, callback);
					},
					socketId: function getSocketIdForUser(callback) {
						Users.getSocketId(userDb, user.id, callback);
					}
				}, function(err, results) {

					if(err) {
						winston.log('error', 'Couldn\'t join room', err);

						room.removeUser(user.id, function() {});

						return next(new restify.InternalError('Couldn\'t join room'));
					}

					if(results.socketId != -1 ) {
						var socket = io.sockets.socket(results.socketId);

						//If they have made a socket.io connection then check if they are in any rooms and join the specific room.
						if(typeof socket !== 'undefined' && socket !== null) {

							//Check if they are in any rooms already
							var currentRooms = io.sockets.manager.roomClients[socket.id];
							if(typeof currentRooms !== 'undefined' && currentRooms !== null && currentRooms.length > 1) {
								return next(new restify.InvalidArgumentError('Already joined a room.'));
							}
							socket.emit('test', {msg: 'hi'});
							socket.join(room.id);
						}
					}

					/*if(results.usersInRoom && results.usersInRoom.length) {


						for(var i = 0; i < results.usersInRoom.length; i++) {
							

							results.usersInRoom[i].id = hashids.encrypt(config.userDbServerId, parseInt(results.usersInRoom[i].id));
						}
					}*/

					//Tell everyone the user joined
					io.sockets.in(room.id).emit('user:joined', {
						user: {
							id: user.hashId,
							name: results.username
						}
					});

					res.json(200, {
						id: room.hashId, 
						owner: hashids.encrypt(config.userDbServerId, parseInt(results.owner)),
						playlist: results.playlist, 
						users: results.usersInRoom
					});
				});
			});

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
server.post('/api/rooms/:roomId/leave', function(req, res, next) {
	//Leave the socket.io room. Can happen just by disconnecting socket.io connection!

	var user = getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip));
	if(user === false) return next(new restify.NotAuthorizedError());

	var room = getRoomFromHash(req.params.roomId);
	if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));

	room.hasUserJoined(user.id, function(err, userHasJoinedAlready) {
		if(!userHasJoinedAlready) {
			res.json(200, {});
			return;
		}

		room.isOwner(user.id, function(err, isOwner) {
			if(isOwner){
				var retries = 3;
				function deleteCallback(err, something) {
					if(err) {
						if(retries--) room.delete(deleteCallback);
						else {
							winston.log('error', 'Couldn\'t remove room', err);
							return next(new restify.InternalError('Couldn\'t remove room'));
						}
					} else {
						//Kick all users and disconnect socket, socket.io should close down the room.
						io.sockets.clients(room.id).forEach(function (socket) { 
							socket.emit('room:closed', { expected: true });
							socket.disconnect();
						});

						res.json(200, {});
					}
				}

				room.delete(deleteCallback);

			} else {
				async.series({
					socketId: function getSocketId(callback) {
						Users.getSocketId(userDb, user.id, callback);
					},

					removeFromRoom: function removeUser(callback) {
						room.removeUser(user.id, callback);
					}
				}, function(err, results) {
					if(err) {
						winston.log('error', 'Couldn\'t remove room', err);
						return next(new restify.InternalError('Couldn\'t leave room'));
					}

					var socket = io.sockets.socket(results.socketId);
					if(typeof socket !== 'undefined' && socket !== null) socket.leave(room.id);

					//Tell everyone the user left
					io.sockets.in(room.id).emit('user:disconnected', {
						user: user.hashId
					});
					res.json(200, {});
				});
			}
		});
	});
});

/** 
 * Owner informs everyone to show the next song is playing.
 * Body: {}
 * Returns: {}
 * Events: playlist:next-song {}
 */
server.post('/api/rooms/:roomId/next-song', function(req, res, next) {
	var user = getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip));
	if(user === false) return next(new restify.NotAuthorizedError());

	var room = getRoomFromHash(req.params.roomId);
	if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));

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
 * Returns: {room: id, playlist: [{},{}]}
 * Events: 
 */
server.get('/api/rooms/:roomId/playlist', function(req, res, next) {
	var room = getRoomFromHash(req.params.roomId);
	if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));

	room.getPlaylist(function(err, playlist) {
		if(err) {
			winston.log('error', 'Failed to get playlist', err);
			return next(new restify.InternalError('Failed to get playlist.'));
		}

		res.json(200, {
			room: room.hashId,
			playlist: playlist
		})
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
 * Returns: {room: id, song: {}}
 * Events: playlist:song-added {song: {}}
 */
server.post('/api/rooms/:roomId/playlist', function(req, res, next) {
	//Add song to redis playlist and broadcast change to all users
	var user = getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip));
	if(user === false) return next(new restify.NotAuthorizedError());

	var room = getRoomFromHash(req.params.roomId);
	if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));

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
				room: room.hashId,
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
server.del('/api/rooms/:roomId/playlist', function(req, res, next) {
	//If isOwner, remove song from redis playlist and broadcast change to all users
	var user = getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip));
	if(user === false) return next(new restify.NotAuthorizedError());

	var room = getRoomFromHash(req.params.roomId);
	if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));

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
server.post('/api/rooms/:roomId/user/:userId/block', function(req, res, next) {
	var user = getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip));
	if(user === false) return next(new restify.NotAuthorizedError());

	var room = getRoomFromHash(req.params.roomId);
	if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));

	var blockedUserIdHash = req.params.userId;
	
	var blockedUserDetails = hashids.decrypt(blockedUserIdHash);
	if(blockedUserDetails.length !== 2) {
		return next(new restify.InvalidArgumentError('Invalid user'));
	} 
	var blockedUserId = roomDetails[1];

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
				user: blockedUserIdHash
			});

			res.json(200, {});
		});
	});
});

/** 
 * Owner unblocks a user
 * Body: {}
 * Returns: {}
 * Events: 
 */
server.post('/api/rooms/:roomId/user/:userId/unblock', function(req, res, next) {
	var user = getUserFromCookie(Cookies.fromHttp(req, res, userCookieKeygrip));
	if(user === false) return next(new restify.NotAuthorizedError());

	var room = getRoomFromHash(req.params.roomId);
	if(room === false) return next(new restify.ResourceNotFoundError('Room not found.'));

	var unblockedUserIdHash = req.params.userId;
	
	var unblockedUserDetails = hashids.decrypt(unblockedUserIdHash);
	if(unblockedUserDetails.length !== 2) {
		return next(new restify.InvalidArgumentError('Invalid user'));
	} 
	var unblockedUserId = roomDetails[1];

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

        data.userIdHash = userIdHash;
        data.userId = null;

        var userDetails = hashids.decrypt(userIdHash);
		if(userDetails.length !== 2) return accept('Invalid user id', false);
		
		data.userIdSeverId = userDetails[0];
		data.userId = userDetails[1];
        
    } else {
       // if there isn't, turn down the connection with a message
       // and leave the function.
       return accept('Cookies must be enabled', false);
    }
    // accept the incoming connection
    accept(null, true);
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
    });
});

server.listen(config.server.port, function () {
    console.log('server listening at %s', server.url);
});




