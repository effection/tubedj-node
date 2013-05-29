Hashids = require('hashids');

function IdGenerator(minLength, key, cache, prefix, generateAhead) {
	
	if(cache)
		//Create an in memory array if cache == true else use the cache object given
		this.cache = new Store((cache === true ? [] : cache);
	else
		this.cache = false;
	
	this.minLength = minLength;
	this.key = key;
	this.prefix = prefix || '';
	this.generateAhead = generateAhead;
	//Create a hasher
	this.hashids = new Hashids(this.key, this.minLength);

	if(this.generateAhead) {
		//TODO Generate ahead ids
	}
}
/**
 * Helper to create an IdGenerator based on config.
 */
IdGenerator.createFromConfig = function(idLength, idKey, opts) {
	var useCache = false, useRedis = false, generateAhead = false, cache = true, prefix = null;
	if(opts) {
		useCache = true;
		useRedis = opts.inRedis;
		generateAhead = opts.generateAhead;
		prefix = opts.prefix || null;
	}

	if(useCache && useRedis) {
		//TODO Redis id caching server details from opts
		//cache = redis.createClient();
	} 

	return new IdGenerator(idLength, idKey, (useCache? cache : false), prefix, generateAhead);
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
IdGenerator.prototype.generate = function(serverId, generateHashed, cb) {
	this.cache.nextId(function(err, nextId) {
		if(err || !generateHashed) {
			cb(err, nextId);
		}

		if(generateHashed) {
			var hashed = this.hashids.encrypt(serverId, nextId);
			this.cache.set(this.prefix + 'id:' + nextId, hashed, cacheCallback);
			this.cache.set(this.prefix + 'h:' + hashed, nextId, cacheCallback);
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
	this.cache.get(this.prefix + 'id:' + id, function(err, hash) {

		//Generate hash
		if(err || hash == null) {
			hash = this.hashids.encrypt(serverId, id);
			//Cache id -> hash
			this.cache.set(this.prefix + 'id:' + id, hash, cacheCallback);
			//Cache hash -> {serverId, id}
			this.cache.hset(this.prefix + 'h:' + hashed, {serverId: serverId, id: id}, cacheCallback);
		}

		cb(null, hash);
	});
}

/**
 * Check cache, else decrypt and return object {id: decypted, serverId: decrypted, : hash: id}
 */
IdGenerator.prototype.decryptHash = function(hash, cb) {
	this.cache.hget(this.prefix + 'h:' + hash, function(err, obj) {

		//Decrypt hash
		if(err || obj == null) {
			obj = this.hashids.decrypt(hash);
			obj = {
				serverId: obj[0],
				id: obj[1]
			}
			//Cache hash - > {serverId, id}
			this.cache.hset(this.prefix + 'h:' + hashed, obj, cacheCallback);
		}

		cb(null, obj);
	});
}

function Store(cache) {
	if(Array.isArray(cache))
		this.cache = true;
	else 
		this.cache = false;
	this.cache = cache;
}

Store.prototype.nextId = function(cb){
	var property = '_next-id';
	if(this.cache) {
		if(this.cache[property] == null) this.cache[property] = 0;
		cb(null, this.cache[property]++);
	}
	else this.cache.incr(property, cb);
}

Store.prototype.get = function(property, cb) {
	if(this.cache) cb(null, this.cache[property]);
	else this.cache.get(property, cb);
}

Store.prototype.set = function(property, value, cb) {
	if(this.cache) this.cache[property] = value;
	else this.cache.set(property, value, (cb == null ? function() {} : cb));
}

Store.prototype.hget = function(property, cb) {
	if(this.cache) cb(null, this.cache[property]);
	else this.cache.hmgetall(property, cb);
}

Store.prototype.hset = function(property, value, cb) {
	if(this.cache) this.cache[property] = value;
	else this.cache.hset(property, value, cb);
}
