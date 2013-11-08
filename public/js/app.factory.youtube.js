'use strict';

app.factory('youtubeFactory', ['$q', function($q)
{
	function pad(num, size) {
		var s = "00" + num;
		return s.substr(s.length-size);
	}
    return {
        parse: function(data)
        {
            var arr = data.feed.entry;
            var items = [ ];
            var item;

            for (var i = 0; i < arr.length; i++)
            {
                item = arr[i];
				
				//Calculate time
				var time = item.media$group.yt$duration.seconds;
				var hours = Math.floor(time / 3600);
				time = time - hours * 3600;
				var minutes = Math.floor(time / 60);
				var seconds = time - minutes * 60;
				
				var duration = { str: "" };
				if(hours > 0) {
					duration.hours = hours;
					duration.str += hours + ":";
				}
				duration.minutes = minutes;
				duration.seconds = seconds;
				duration.str += pad(minutes, 2) + ":" + pad(seconds, 2);
				
				var video = {
                    href: item.link[0].href,
                    thumbnail: item.media$group.media$thumbnail[0].url,
                    title: item.title.$t,
					author: { name: item.author[0].name.$t, url: item.author[0].uri.$t},
					published: item.published.$t,
					duration: duration
                };
				if(item.yt$statistics)
					video.views = item.yt$statistics.viewCount;

                items.push(video);
            }

            return items;
        }
    };
}]);