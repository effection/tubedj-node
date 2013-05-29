Hashids = require('hashids');

function IdGenerator(minLength, key, cache) {
	
	this.mem = new Store(cache);
	
	this.minLength = minLength;
	this.cache = cache;
	this.key = key;

	this.hashids = new Hashids(this.key, this.minLength);
}

module.exports = IdGenerator;

function cacheCallback(err, result) {
		if(err) {
			//Just an error storing the cache
		}
	}

/**
 * Generate a new id/Get new id from list of generated ids
 * Cache encrypted version of id & serverId combination
 * Cache encrypted version -> decrypted id
 * 
 */
IdGenerator.prototype.generate = function(serverId, cb, generateHashed) {
	this.mem.nextId(function(err, nextId) {
		if(err || !generateHashed) {
			cb(err, nextId);
		}

		if(generateHashed) {
			var hashed = this.hashids.encrypt(serverId, nextId);
			this.mem.set('id:' + nextId, hashed, cacheCallback);
			this.mem.set('h:' + hashed, nextId, cacheCallback);
			cb(null, {
				serverId: serverId,
				id: nextId
			});
		}
	});
}

/**
 * Check cache, else encrypt
 */
IdGenerator.prototype.encryptId = function(serverId, id, cb) {
	this.mem.get('id:' + id, function(err, hash) {

		//Generate hash
		if(err || hash == null) {
			hash = this.hashids.encrypt(serverId, id);
			//Cache id -> hash
			this.mem.set('id:' + id, hash, cacheCallback);
			//Cache hash -> {serverId, id}
			this.mem.hset('h:' + hashed, {serverId: serverId, id: id}, cacheCallback);
		}

		cb(null, hash);
	});
}

/**
 * Check cache, else decrypt and return object {id: decypted, serverId: decrypted, : hash: id}
 */
IdGenerator.prototype.decryptId = function(hash, cb) {
	this.mem.hget('h:' + hash, function(err, obj) {

		//Decrypt hash
		if(err || obj == null) {
			obj = this.hashids.decrypt(hash);
			obj = {
				serverId: obj[0],
				id: obj[1]
			}
			//Cache hash - > {serverId, id}
			this.mem.hset('h:' + hashed, obj, cacheCallback);
		}

		cb(null, obj);
	});
}

function Store(cache) {
	if(Array.isArray(cache))
		this.mem = true;
	else 
		this.mem = false;
	this.cache = cache;
}

Store.prototype.nextId = function(cb){
	var property = '_next-id';
	if(this.mem) cb(null, this.cache[property]++);
	else this.cache.incr(property, cb);
}

Store.prototype.get = function(property, cb) {
	if(this.mem) cb(null, this.cache[property]);
	else this.cache.get(property, cb);
}

Store.prototype.set = function(property, value, cb) {
	if(this.mem) this.cache[property] = value;
	else this.cache.set(property, value, (cb == null ? function() {} : cb));
}

Store.prototype.hget = function(property, cb) {
	if(this.mem) cb(null, this.cache[property]);
	else this.cache.hmgetall(property, cb);
}

Store.prototype.hset = function(property, value, cb) {
	if(this.mem) this.cache[property] = value;
	else this.cache.hset(property, value, cb);
}
