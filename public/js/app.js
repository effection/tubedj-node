var app = angular.module('tubedjApp', ['restangular']);

app.config(function($routeProvider, $locationProvider, RestangularProvider) {
	$routeProvider.when('/home', {
		templateUrl: 'home.html'
	})
	.when('/options', {
		templateUrl: 'options.html'
	})
	.when('/search', {
		templateUrl: 'search.html',
	})
	.when('/playlist', {
		templateUrl: 'playlist.html'
	})
	.when('/now-playing', {
		templateUrl: 'now-playing.html'
	})
	.when('/qr-code', {
		templateUrl: 'qr-code-viewer.html'
	})
	.otherwise({
		redirectTo: '/home'
	});

	$locationProvider.html5Mode(true);

	RestangularProvider.setBaseUrl('http://192.168.0.6\\:8081/api');
});