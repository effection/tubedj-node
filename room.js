var async = require('async');

function Room(client, id) {
	this.id = id;
	this.client = client;
	this.owner = null;
}

module.exports = Room;

Room.create = function(client, owner, cb) {
	client.incr('next-room-id', function(error, nextId) {
		var room = new Room(client, nextId);
		room.owner = owner;
		client.multi()
			.set('rooms:'+nextId, 1)
			.set(room.key('owner'), owner)
			.set(room.key('next-song-uid'), 0)
			.exec(function (err, replies) {
	            if(err) cb(err, null);
	            else    cb(null, room);
	        });
	});
}

Room.exists = function(client, room, cb) {
	client.get('rooms:' + room, cb);
} 

Room.prototype.key = function(sub) {
	return 'rooms:' + this.id + ':' + sub;
}

/**
 * Is user owner of room? 
 * Callback: function(err, isOwner:bool) {}
 */
Room.prototype.isOwner = function(user, cb) {
	this.getOwner(function(err, owner) {
		if(err) return cb(err, false);
		else	return cb(null, owner == user);
	});
}

/**
 * Delete the room from the db
 */
Room.prototype.delete = function(cb) {
	// delete rooms:id, rooms:id:playlist, rooms:id:users, rooms:id:songs, rooms:id:blocked, rooms:id:next-song-uid
	this.client.multi()
		.del('rooms:' + this.id)
		.del(this.key('owner'))
		.del(this.key('playlist'))
		.del(this.key('songs'))
		.del(this.key('users'))
		.del(this.key('blocked'))
		.del(this.key('next-song-uid'))
		.exec(function (err, replies) {
            if(err) cb(err, null);
            else    cb(null, null);
        });
}

/**
 * Callback: function(error, items) {}
 */
Room.prototype.getPlaylist = function(cb) {
	
	/*
	var self = this;
	this.client.lrange(this.key('playlist'), 0, -1, function(err, playlist) {
		if(err) {
			cb(err, null);
			return;
		}

		if(playlist.length <= 0) {
			cb(null, []);
			return;
		}


		self.client.hgetall(self.key('songs'), function(err, songs) {
			if(err) {
				cb(err, null);
				return;
			}

			if(typeof songs !== 'undefined' || songs === null) {
				cb(null, []);
				return;
			}

			var populatedPlaylist = [];
			playlist.forEach(function(songUid) {
				populatedPlaylist.push(songs[songUid]);
			});

			cb(null, populatedPlaylist);
		});
	});*/
	//var base = this.key('songs:*');
	//this.client.sort(this.key('playlist'), "BY", "nosort", "GET", base+'*->uid', "GET", base+'*->id', "GET", base+'*->isYt', "GET", base+'*->owner', cb);
	
	var self = this;
	this.client.lrange(this.key('playlist'), 0, -1, function(err, playlist) {
		if(err) {
			cb(err, null);
			return;
		}

		if(playlist.length <= 0) {
			cb(null, []);
			return;
		}
		var multi = self.client.multi();
		var populatedPlaylist = [];

		playlist.forEach(function(songUid) {
			multi.hgetall(self.key('songs:' + songUid), function(err, song) {
				if(err) {
					cb(err, null);
					return;
				}

				if(song === null) {
					cb(null, []);
					return;
				}

				populatedPlaylist.push(song);
			});
		});
		multi.exec(function(err, result) {
			if(err) {
				cb(err, null);
				return;
			}
			cb(null, populatedPlaylist);
		});
	});
}

/**
 * Add song to end of playlist.
 * Callback: function() {}
 */
Room.prototype.addToPlaylist = function(song, cb) {
	//Create an unique instance id for easy deletion
	var self = this;
	
	async.series({
		storeSong: function storeSongDetails(callback) {
			//Store the owner keyed by instance id for easy removal
			self.client.hmset(self.key('songs:'+song.uid),  song, callback);
			//Store the full song hash
			//self.client.hmset(self.key('songs:' + song.uid), song, callback);
		},
		updateList: function updatePlaylist(callback) {
			//Store the song uid in the playlist
			self.client.rpush(self.key('playlist'), song.uid, callback);
		}
	}, cb);
}

/**
 * Playlist songs UID.
 */
Room.prototype.getUniquePlaylistId = function(cb) {
	this.client.incr(this.key('next-song-uid'), cb);
}

/**
 * Add song to end of playlist.
 * Callback: function() {}
 */
 Room.prototype.popCurrentSongOffPlaylist = function(cb) {
 	var self = this;
 	this.client.lpop(this.key('playlist'), function(err, firstSongUid) {
 		if(err) {
 			cb(err, null);
 			return;
 		}

 		if(typeof firstSongUid !== 'undefined' || firstSongUid === null) {
 			cb('playlist-empty', null);
 			return;
 		}
 		//self.client.hdel(self.key('songs'), firstSongUid, cb);
 		self.client.del(self.key('songs:'+firstSongUid), cb);
 	});
 }

/**
 * Remove song from playlist.
 * Callback: function() {}
 */
Room.prototype.removeFromPlaylist = function(songUid, cb) {
	var self = this;

	async.series({
		removeSong: function removeSongHash(callback) {
			//self.client.hdel(self.key('songs'), songUid, callback);
			self.client.del(self.key('songs:'+songUid), callback);
		},
		removeSongFromPlaylist: function removeSong(callback) {
			//Remove first (and only) song uid from playlist
			this.client.lrem(this.key('playlist'), 1, songUid, callback);
		}
	}, cb);
}

/**
 * Get owner id of song from song id or index
 * Callback: function() {}
 */
Room.prototype.getSongOwner = function(songUid, cb) {
	//this.client.hget(this.key('songs'), songUid, cb);
	this.client.hget(this.key('songs:'+songUid), 'owner', cb);
}

Room.prototype.hasUserJoined = function(user, cb) {
	this.client.sismember(this.key('users'), user, cb);
}

/**
 * Get users in room
 * Callback: function() {}
 */
Room.prototype.getUsers = function(cb) {
	this.client.smembers(this.key('users'), cb);
}

/**
 * Add user to room.
 * Callback: function() {}
 */
Room.prototype.addUser = function(user, cb) {
	this.client.sadd(this.key('users'), user, cb);
}

/**
 * Remove user from room.
 * Callback: function() {}
 */
Room.prototype.removeUser = function(user, cb) {
	this.client.srem(this.key('users'), user, cb);
}

/**
 * Block user
 * Callback: function() {}
 */
Room.prototype.blockUser = function(user, cb) {
	this.client.sadd(this.key('blocked'), user, cb);
}

/**
 * Unblock user
 * Callback: function() {}
 */
Room.prototype.unblockUser = function(user, cb) {
	this.client.srem(this.key('blocked'), user, cb);
}

/**
 * Block user
 * Callback: function() {}
 */
Room.prototype.isUserBlocked = function(user, cb) {
	this.client.sismember(this.key('blocked'), user, cb);
}

/**
 * Get owner of the room. 
 * Callback: function() {}
 */
Room.prototype.getOwner = function(cb) {
	if(this.owner === null) this.client.get(this.key('owner'), cb) 
	else cb(null, this.owner);
}
