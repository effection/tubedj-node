app.controller('RoomController', ['$scope', 'Restangular', 'Socket', function RoomController($scope, Restangular, socket) {

	var rooms = Restangular.all('rooms');

	$scope.id = "pT9yCxi7";
	$scope.owner = null;
	$scope.playlist = [];
	$scope.users = [];

	$scope.room = null;


	//user:joined {user: id, name: string}
	//user:disconnected {user: id}
	//room:closed {expected: bool}
	//playlist:next-song {}
	//playlist:song-added {song: {}}
	//playlist:song-removed {songIndex: index}
	socket.on('test', function(msg) {
		console.log('test', msg);
	})
	socket.on('user:joined', function (user) {
		console.log(user);
		$scope.users.push(user);
	});
	socket.on('user:disconnected', function (user) {
		console.log('User disconnected');
		var index, found = false;
		for(index = 0; i < $scope.users.length; index++) {
			if($scope.users[index].id == user){
				console.log('Found');
				found = true;
				break;
			}
		}
		if(found) $scope.users.splice(index, 1);
	});
	socket.on('room:closed', function (data) {
		console.log('Room closed. ' + (data.expected ? ' Expected...' : 'Wasn\'t expected!'));
	});
	socket.on('playlist:next-song', function (data) {
		console.log('Mark next song as playing');
		if($scope.playlist.length > 0) {
			var lastSong = $scope.playlist.shift();
			console.log('Removed song from playlist', lastSong);
		}
	});
	socket.on('playlist:song-added', function (data) {
		console.log('New song added', data);
		$scope.playlist.push(data.song);
	});
	socket.on('playlist:song-removed', function (data) {
		console.log('Song removed from playlist', data);
		var index, found = false;
		for(index = 0; i < $scope.playlist.length; index++) {
			if($scope.playlist[index].uid == data.songUId){
				console.log('Found');
				found = true;
				break;
			}
		}
		if(found) $scope.users.splice(index, 1);
	});


	
	$scope.createUser = function() {
		Restangular.all('users').post({name: 'Jordan'}).then(function(response) {
			console.log('New user', response);
		}, function(reason) {
			$scope.onError({
				msg: 'Couldn\'t create user'
			}, true);
		});
	};

	/**
	 * Create a new room.
	 */
	$scope.create = function() {
		rooms.post({}).then(function(response) {
			$scope.id = response.room;
			$scope.join(response.room);
		}, function(reason) {
			$scope.onError({
				msg: 'Couldn\'t create room'
			}, true);
		});
	};

	/**
	 * Join an already existing room.
	 */
	$scope.join = function(roomId) {
		if(roomId === null || roomId.length < 8) return;

		Restangular.one('rooms', roomId).get().then(function(response) {
			$scope.GlobalState.room.id = response.id;

			$scope.room = response;

			$scope.id = response.id;
			$scope.owner = response.owner;
			$scope.playlist = response.playlist;
			$scope.users = response.users;

			console.log('Joined room: ' + roomId);

		}, function(reason) {
			$scope.onError({
				msg: 'Couldn\'t join room'
			}, true);
		});
	};

	$scope.onError = function(error, show) {
		console.error(error);
	};

	$scope.leave = function() {
		console.log('leave');
	};

	$scope.nextSong = function() {
		if($scope.owner != $scope.GlobalState.user.id) {
			//TODO Alert disallowed to force next song
			console.log('Next song success');
		} else {
			$scope.room.all('next-song').post().then(function() {
				//TODO nextSong() success 
			}, function(reason) {
				$scope.onError({
					msg: 'Couldn\'t play next song'
				}, true);
			});
		}
	};

	$scope.refreshPlaylist = function() {
		$scope.room.all('playlist').getList().then(function(response) {
			console.log('Refreshed');
		}, function(reason) {
			$scope.onError({
					msg: 'Couldn\'t refresh playlist'
				}, true);
		});
	};

	$scope.addToPlaylist = function(song) {
		$scope.room.all('playlist').post({song: song}).then(function() {
			//Socket.io will send a message which will update $scope.playlist
			console.log('Song added to playlist');
		}, function(reason) {
			$scope.onError({
				msg: 'Couldn\'t add song to playlist'
			}, true);
		});
	};

	$scope.removeFromPlaylist = function(songUid) {

		$scope.room.all('playlist').delete({songUid: songUid}).then(function() {
			//Socket.io will send a message which will update $scope.playlist
			console.log('Song removed from playlist');
		}, function(reason) {
			$scope.onError({
				msg: 'Couldn\'t remove song from the playlist'
			}, true);
		});
	};

	$scope.blockUser = function(userId) {
		console.log('User blocked');
	};

	$scope.unblockUser = function(userId) {
		console.log('User unblocked');
	};

	$scope.newPlaylistId = "";
	$scope.newPlaylistArtist = "";
	$scope.newPlaylistAlbum = "";
	$scope.newPlaylistTitle = "";
	$scope.newPlaylistLength = "";

	$scope.joinHelper = function() {
		$scope.join($scope.id);
	};
	$scope.addSongToPlaylistHelper = function() {
		if($scope.newPlaylistId.length <= 0) return;

		var song = {};
		if($scope.newPlaylistTitle.length > 0) {
			song.id = $scope.newPlaylistId;
			song.title = $scope.newPlaylistTitle;
			song.artist = $scope.newPlaylistAlbum;
			song.album = $scope.newPlaylistAlbum;
			song.length = $scope.newPlaylistLength;
		} else {
			song.yt = $scope.newPlaylistId;
		}

		$scope.addToPlaylist(song);
	};
	
}]);