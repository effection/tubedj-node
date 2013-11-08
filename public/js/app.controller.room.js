app.controller('RoomController', ['$scope', 'Restangular', 'Socket', 'youtubeService', function RoomController($scope, Restangular, socket, youtubeService) {

	var rooms = Restangular.all('rooms');

	$scope.username = 'Browser';

	$scope.id = "";
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
	socket.on('user:joined', function (data) {
		console.log('User joined', data);
		$scope.users.push(data.user);
	});
	socket.on('user:disconnected', function (data) {
		console.log('User disconnected', data);
		var index, found = false;
		for(index = 0; index < $scope.users.length; index++) {
			if($scope.users[index].id == data.user){
				console.log('Found');
				found = true;
				break;
			}
		}
		if(found) $scope.users.splice(index, 1);
	});
	socket.on('room:closed', function (data) {
		console.log('Room closed. ' + (data.expected ? ' Expected...' : 'Wasn\'t expected!'));

		if(data.expected) {

			$scope.room = null;
			//$scope.id = '';
			$scope.owner = null;
			$scope.playlist = [];
			$scope.users = [];

		}

	});
	socket.on('playlist:next-song', function (data) {
		console.log('Mark next song as playing');
		if($scope.playlist.length > 0) {
			var lastSong = $scope.playlist.shift();
			console.log('Removed song from playlist', lastSong);

			//TODO Load next youtube song
		}
	});
	socket.on('playlist:song-added', function (data) {
		console.log('New song added', data);

		youtubeService.getSong(data.song.id)
		.then(function(youtubeResult) {
			youtubeResult.ownerName = '';

			for(var i = 0; i < $scope.users.length; i++) {
				if($scope.users[i].id === data.song.owner) {
					youtubeResult.ownerName = $scope.users[i].name;
					break;
				}
			}
			youtubeResult.uid = data.song.uid;


			$scope.playlist.push(youtubeResult);
		}, function() {
			//Error
		});

		
		//TODO IF first song load song
	});
	socket.on('playlist:song-removed', function (data) {
		console.log('Song removed from playlist', data);
		var index, found = false;
		for(index = 0; index < $scope.playlist.length; index++) {
			if($scope.playlist[index].uid == data.songUId){
				console.log('Found');
				found = true;
				break;
			}
		}
		if(found) $scope.users.splice(index, 1);
	});


	
	$scope.createUser = function() {
		if($scope.GlobalState.user.name.length < 3 && $scope.GlobalState.user.name.length > 10) {
			$scope.onError({
				msg: 'Name must be between 3 and 10 characters', 
				reason: reason
			}, true);
			return;
		}

		Restangular.all('users').post({name: $scope.GlobalState.user.name}).then(function(response) {
			console.log('New user', response);
			$scope.GlobalState.user.name = response.name;
			$scope.GlobalState.user.id = response.id;
		}, function(reason) {
			if(reason.status == 300) {
				$scope.createUser();
				return;
			} 
			$scope.onError({
				msg: 'Couldn\'t create user', 
				reason: reason
			}, true);
		});
	};

	$scope.leave = function() {
		//socket.disconnect();
		//TODO
		//socket.restart();
		$scope.room.all('leave').post().then(function(response) {

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
				msg: 'Couldn\'t create room', 
				reason: reason
			}, true);
		});
	};

	/**
	 * Join an already existing room.
	 */
	$scope.join = function(roomId) {
		if(roomId === null || roomId.length < 8) return;

		$scope.users = [$scope.GlobalState.user];

		Restangular.one('rooms', roomId).get().then(function(response) {
			$scope.GlobalState.room.id = response.id;

			$scope.room = response;

			$scope.id = response.id;
			$scope.owner = response.owner;
			$scope.playlist = response.playlist;
			$scope.users = $scope.users.concat(response.users);

			console.log('Joined room: ' + roomId);

		}, function(reason) {
			$scope.onError({
				msg: 'Couldn\'t join room', 
				reason: reason
			}, true);
		});
	};

	$scope.onError = function(error, show) {
		console.error(error);
		alert(error);
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
					msg: 'Couldn\'t play next song', 
				reason: reason
				}, true);
			});
		}
	};

	$scope.refreshPlaylist = function() {
		$scope.room.all('playlist').getList().then(function(response) {
			console.log('Refreshed');
		}, function(reason) {
			$scope.onError({
				msg: 'Couldn\'t refresh playlist', 
				reason: reason
			}, true);
		});
	};

	$scope.addToPlaylist = function(song) {
		$scope.room.all('playlist').post({song: song}).then(function() {
			//Socket.io will send a message which will update $scope.playlist
			console.log('Successful add to playlist request');
		}, function(reason) {
			$scope.onError({
				msg: 'Unsuccessful add to playlist request', 
				reason: reason
			}, true);
		});
	};

	$scope.removeFromPlaylist = function(songUid) {

		$scope.room.all('playlist').delete({songUid: songUid}).then(function() {
			//Socket.io will send a message which will update $scope.playlist
			console.log('Successful remove from playlist request');
		}, function(reason) {
			$scope.onError({
				msg: 'Unsuccessful remove from playlist request', 
				reason: reason
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

	$scope.nextSongHelper = function() {
		$scope.nextSong();
	}
	
}]);