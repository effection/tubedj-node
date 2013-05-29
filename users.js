function Users() {}

module.exports = Users;

Users.create = function(db, name, cb) {
	db.incr('next-user-id', function(error, nextId) {
		db.multi()
			//.hset('users:'+nextId, 'id', nextId)
			.hset('users:'+nextId, 'name', name)
			.hset('users:'+nextId, 'socket', -1)
			.exec(function (err, replies) {
	            if(err) cb(err, null);
	            else    cb(null, nextId);
	        });
	});
}

Users.getSantisedUsers = function(db, ids, cb) {
	var multi = db.multi();
	var users = [];
	for(var i = 0; i < ids.length; i++) {
		(function(index) {
			multi.hget('users:'+ids[i], 'name', function(err, name) {
				if(name) {
					users.push({ id: ids[index], name: name});
				}
			});
		})(i);
	}

	multi.exec(function(err, names) {
		//We constructed users to place ids in
		if(err) cb(err, null);
		else cb(null, users);

	});
}

Users.getName = function(db, id, cb) {
	db.hget('users:'+id, 'name', cb);
}

Users.getSocketId = function(db, uid, cb) {
	db.hget('users:'+uid, 'socket', cb);
}

Users.updateSocketId = function(db, uid, sid, cb) {
	db.hset('users:'+uid, 'socket', sid, cb);
}