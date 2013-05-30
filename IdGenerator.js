Hashids = require('hashids');

function IdGenerator(minLength, key, cache, prefix, generateAhead) {
	
	if(cache)
		//Create an in memory array if cache == true else use the cache object given
		this.cache = new Store((cache === true ? [] : cache), prefix);
	else
		this.cache = false;
	
	this.minLength = minLength;
	this.key = key;
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
	var self = this;
	this.cache.nextId(function(err, nextId) {
		if(err || !generateHashed) {
			cb(err, nextId);
		}

		if(generateHashed) {
			var hashed = self.hashids.encrypt(serverId, nextId);
			self.cache.set('id:' + nextId, hashed, cacheCallback);
			self.cache.hset('h:' + hashed, {serverId: serverId, id: nextId}, cacheCallback);
			cb(null, {
				serverId: serverId,
				id: nextId,
				hashId: hashed
			});
		}
	});
}

/**
 * Check cache, else encrypt
 */
IdGenerator.prototype.encryptId = function(idObj, cb) {
	var self = this;
	this.cache.get(this.prefix + 'id:' + idObj.id, function(err, hash) {

		//Generate hash
		if(err || hash == null) {
			hash = self.hashids.encrypt(idObj.serverId, idObj.id);
			//Cache id -> hash
			self.cache.set('id:' + idObj.id, hash, cacheCallback);
			//Cache hash -> {serverId, id}
			self.cache.hset('h:' + hash, {serverId: idObj.serverId, id: idObj.id}, cacheCallback);
		}

		cb(null, hash);
	});
}

/**
 * Check cache, else decrypt and return object {id: decypted, serverId: decrypted, : hash: id}
 */
IdGenerator.prototype.decryptHash = function(hash, cb) {
	var self = this;
	this.cache.hget('h:' + hash, function(err, obj) {

		//Decrypt hash
		if(err || obj == null) {
			obj = self.hashids.decrypt(hash);
			obj = {
				serverId: obj[0],
				id: obj[1]
			}
			//Cache hash - > {serverId, id}
			self.cache.hset('h:' + hash, obj, cacheCallback);
		}

		cb(null, obj);
	});
}

function Store(cache, prefix) {
	this.isMem = Array.isArray(cache);
	this.cache = cache;
	this.prefix = prefix || '';
}

Store.prototype.nextId = function(cb){
	var property = this.prefix+'-next-id';
	if(this.isMem) {
		if(this.cache[property] == null) this.cache[property] = 0;
		cb(null, this.cache[property]++);
	}
	else this.cache.incr(property, cb);
}

Store.prototype.get = function(property, cb) {
	property = this.prefix + property;
	if(this.isMem) cb(null, this.cache[property]);
	else this.cache.get(property, cb);
}

Store.prototype.set = function(property, value, cb) {
	property = this.prefix + property;
	if(this.isMem) this.cache[property] = value;
	else this.cache.set(property, value, (cb == null ? function() {} : cb));
}

Store.prototype.hget = function(property, cb) {
	property = this.prefix + property;
	if(this.isMem) cb(null, this.cache[property]);
	else this.cache.hmgetall(property, cb);
}

Store.prototype.hset = function(property, value, cb) {
	property = this.prefix + property;
	if(this.isMem) this.cache[property] = value;
	else this.cache.hset(property, value, cb);
}
