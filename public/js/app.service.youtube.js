'use strict';

app.service('youtubeService', ['$q', '$http', 'youtubeFactory', function($q, $http, youtubeFactory)
{
    return {
        search: function(searchQuery)
        {
            var dfd = $q.defer();
			
			var q = '';
			var startIndex = 1;
			var maxResults = 10;
			
			if(typeof(searchQuery) == 'object') {
				q = searchQuery.q;
				startIndex = searchQuery.startIndex;
			}else
				q = searchQuery;

            $http
            .jsonp('http://gdata.youtube.com/feeds/api/videos?alt=json&start-index=' + startIndex + '&max-results=' + maxResults + '&q=' + encodeURIComponent(q) + '&callback=JSON_CALLBACK')
            .success(function(results)
            {
                var items = youtubeFactory.parse(results);

                dfd.resolve(items);
            })
            .error(function()
            {
                dfd.reject();
            });

            return dfd.promise;
        },
        getSong: function(songId)
        {
            var url = 'https://gdata.youtube.com/feeds/api/videos/'+songId+'?v=2&alt=json';

            var dfd = $q.defer();

            $http
            .jsonp(url + '&callback=JSON_CALLBACK')
            .success(function(results)
            {
                results.feed = { entry : [results.entry] };
                var items = youtubeFactory.parse(results);

                dfd.resolve(items[0]);
            })
            .error(function()
            {
                dfd.reject();
            });

            return dfd.promise;
        }
    };
}]);