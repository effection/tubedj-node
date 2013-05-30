var config = require('config')
  , async = require('async')
  , IdGenerator = require('./IdGenerator.js');

var UserIdGenerator = IdGenerator.createFromConfig(config.users.idLength, config.users.idKey, config.users.cacheIds);

function Users() {}

module.exports = Users;

Users.IdGenerator = UserIdGenerator;

/**
 * Returns null or {id, serverId, hashId}
 */
Users.create = function(db, name, cb) {

	UserIdGenerator.generate(config.db.users.id, true, function(err, idObj) {
		if(err) {
			cb(err, null);
			return;
		}

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
}

Users.exists = function(db, id, cb) {
	db.exists('users:' + id, cb);
}

/**
 * Loop round all ids getting their hash and name. TODO make UserIdGenerator able to send multi() requests
 */
Users.getSantisedUsers = function(db, ids, cb) {
	//var multi = db.multi();
	var users = [];
	for(var i = 0; i < ids.length; i++) {
		(function(index) {

			async.parallel({
				name: function getName(callback) {
					db.hget('users:'+ids[i], 'name', callback);
				},

				hashId: function getHashId(callback) {
					UserIdGenerator.encryptId({serverId: config.db.users.id, id: ids[index]}, callback);
				}
			}, function (err, results) {
				users.push({ id: results.hashId, name: results.name});
			});

			/*multi.hget('users:'+ids[i], 'name', function(err, name) {
				if(name) {
					users.push({ id: ids[index], name: name});
				}
			});*/
		})(i);
	}

	/*multi.exec(function(err, names) {
		//We constructed users to place ids in
		if(err) cb(err, null);
		else cb(null, users);

	});*/
}

/**
 * Get user's name from id.
 */
Users.getName = function(db, id, cb) {
	db.hget('users:'+id, 'name', cb);
}

/**
 * Get user's associated socket.io id if set.
 */
Users.getSocketId = function(db, uid, cb) {
	db.hget('users:'+uid, 'socket', cb);
}

/**
 * Update user's associated socket.ioid.
 */
Users.updateSocketId = function(db, uid, sid, cb) {
	db.hset('users:'+uid, 'socket', sid, cb);
}