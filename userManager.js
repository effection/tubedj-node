var _ = require('underscore')
  , config = require('config')
  , async = require('async')
  , IdGenerator = require('./IdGenerator.js')
  , redis = require('redis');

var UserIdGenerator = IdGenerator.createFromConfig(config.users.idLength, config.users.idKey, config.users.cacheIds);

var rr_nextServer = 0;
var dbs = {};

var servers = config.db.users;

for(var serverKey in servers) {
	//TODO Check server.options and do auth
	var server = servers[serverKey];
	var client = redis.createClient();
	client.on('error', function(err) {
		winston.log('errror', 'Redis client error', err);
	});

	dbs[server.id] = client;
}

var UserManager = {
	/**
	 * Get connection for server id.
	 */
	dbFor: function(serverId) {
		return dbs[serverId];
	},

	/**
	 * Create key for db lookup.
	 */
	keyFor: function(userId, sub) {
		return 'users:' + userId + (sub? ':' + sub : '');
	},

	/**
	 * Turn a hash id into its original form.
	 */
	decodeHash: function(hash, cb) {
		UserIdGenerator.decryptHash(hash, cb);
	},

	/**
	 * Turn an into its hash form for user facing sides.
	 */
	encodeId: function(serverId, userId, cb) {
		UserIdGenerator.encryptHash({
			serverId: serverId,
			id: userId
		}, cb);
	},

	/**
	 * Check if room exists on server.
	 */
	userExists: function(serverId, userId, cb) {
		UserManager.dbFor(serverId).exists('users:' + userId, cb);
	},

	/**
	 * Create user on server. Round robin for picking server.
	 */
	create: function(name, cb) {
		var useServerId = servers[rr_nextServer].id;


		UserIdGenerator.generate(useServerId, true, function(err, idObj) {
			if(err) {
				cb(err, null);
				return;
			}

			var db = UserManager.dbFor(idObj.serverId);

			db.multi()
				.hset('users:'+idObj.id, 'name', name)
				.hset('users:'+idObj.id, 'socket', -1)
				.exec(function (err, replies) {
		            if(err) cb(err, null);
		            else {
		            	cb(null, idObj);
		            }
		        });
		});

		rr_nextServer = (rr_nextServer + 1) % servers.length;
	},


	/**
	 * Get user from server. Optional check if user exists in db.
	 */
	getUser: function(serverId, userId, checkExists, cb) {
		var db = UserManager.dbFor(serverId);
		if(!db) return cb(new Error('No database for serverId'));

		var user = new User(db, userId, serverId);

		if(checkExists) {
			db.exists(UserManager.keyFor(userId), function(err, exists) {
				if(err) return cb(err);

				if(exists) return cb(null, user);
				else return cb(null, false); 
			})
		} else
			cb(null, user);
	},

	/**
	 * Decode hash and return user object.
	 */
	getUserFromHash: function(hash, checkExists, cb) {
		UserManager.decodeHash(hash, function(err, idObj) {
			if(err) return cb(err);

			UserManager.getUser(idObj.serverId, idObj.id, checkExists, cb);
		});
	}
};

module.exports = UserManager;

function User(client, id, serverId) {
	this.id = id;
	this.serverId = serverId;
	this.client = client;
}

/**
 * Generate the base key.
 */
User.prototype.key = function(sub) {
	return 'users:' + this.id + (sub == null? '' : (':' + sub));
}

/**
 * Delete user hash.
 */
User.prototype.delete = function(cb) {
	this.client.del(this.key(), cb);
}

/**
 * Get user's name from id.
 */
User.prototype.getName = function(cb) {
	this.client.hget(this.key(), 'name', cb);
}

/**
 * Set a new name.
 */
User.prototype.changeName = function(newName, cb) {
	this.client.hset(this.key(), 'name', newName, cb);
}

/**
 * Get current room id
 */
User.prototype.getCurrentRoom = function(cb) {
	this.client.hget(this.key(), 'current-room', cb);
}

/**
 * Set current room id
 */
User.prototype.setCurrentRoom = function(rid, cb) {
	this.client.hset(this.key(), 'current-room', rid, cb);
}

/**
 * Set current room id
 */
User.prototype.deleteCurrentRoom = function(cb) {
	this.client.hdel(this.key(), 'current-room', cb);
}


/**
 * Get user's associated socket.io id if set.
 */
User.prototype.getSocketId = function(cb) {
	this.client.hget(this.key(), 'socket', cb);
}

/**
 * Update user's associated socket.io id.
 */
User.prototype.updateSocketId = function(sid, cb) {
	this.client.hset(this.key(), 'socket', sid, cb);
}
