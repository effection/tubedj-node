var config = {
	server: {
		name: 'tubedj-server',
		port: 8081
	},

	/**
	 * Basic room setup.
	 */
	rooms: {
		/**
		 * User facing id hashing
		 */
		idLength: 8,
		idKey: 'R00mKey17',

		/**
		 * Cache encrypted/decrypted room ids for speed in memory or redis.
		 */
		cacheIds: {
			/**
			 * Storage prefix.
			 */
			prefix: '',

			/**
			 * Maintain a list of new ids ready to use.
			 */
			generateAhead: false,

			/**
			 * Use a redis instance to store all caching.
			 */
			inRedis: false
		},

		/**
		 * API throttling per IP.
		 */
		apiThrottling: {
			createRoom: {},
			joinRoom: {},
			getPlaylist: {},
			addToPlaylist: {},
			removeFromPlaylist: {},
			blockUser: {},
			unblockUser: {}
		}
	},

	/**
	 * Basic users setup.
	 */
	users: {
		/**
		 * User facing id hashing
		 */
		idLength: 8,
		idKey: 'U5er5Key17',

		cookie: {
			/**
			 * Cookie name.
			 */
			name: 'tubedj-id',

			/**
			 * Keys used to sign the cookie.
			 */
			keys: [
				'MySecretTubeDjKey02',
				'MySecretTubeDjKey01'
			];

		}

		/**
		 * Cache encrypted/decrypted user ids for speed in memory or redis.
		 */
		cacheIds: {
			/**
			 * Storage prefix.
			 */
			prefix: '',
			
			/**
			 * Maintain a list of new ids ready to use.
			 */
			generateAhead: false,

			/**
			 * Use a redis instance to store all caching.
			 */
			inRedis: false
		},

		/**
		 * API throttling per IP.
		 */
		apiThrottling: {
			createUser: {},
			getUser: {},
			getUsers: {}
		}
	},

	/**
	 * Basic db setup.
	 */
	db: {
		/**
		 * Redis connection details for Room storage.
		 */
		redisForRooms: {
			id: 0
		},

		/**
		 * Redis connection details for User storage.
		 */
		redisForUsers: {
			id: 0
		},

		/**
		 * Redis connection details for caching Room Ids if turned on.
		 */
		redisForRoomIdsCache: {
			id: 0
		},

		/**
		 * Redis connection details for caching User Ids if turned on.
		 */
		redisForUserIdsCache: {
			id: 0
		}
	},

	redisServerId: 0,
	userDbServerId: 0,
	cookieId: 'tubedj-id'
};

module.exports = config;