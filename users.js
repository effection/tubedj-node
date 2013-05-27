function Users() {}

module.exports = Users;

Users.create = function(db, name, cb) {
	db.incr('next-user-id', function(error, nextId) {
		db.multi()
			.hset('users:'+nextId, 'name', name)
			.hset('users:'+nextId, 'socket', -1)
			.exec(function (err, replies) {
	            if(err) cb(err, null);
	            else    cb(null, nextId);
	        });
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