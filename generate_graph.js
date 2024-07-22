// get data from api
var heights = [];
var timestamps = [];
var a, b, c, h;

// get time from 12 hours ago in seconds (14400 seconds to adjust from gmt to est, 43200 seconds to adjust for 12 hours)
var now = parseInt(Date.now() / 1000) - 14400 - 43200;


// fetch points form past 12 hours
fetch('https://octidesapi.andrewtrackim.com/get-depth-since/' + now)
    .then(response => response.json())
    .then(data => {
        for (var i = 0; i < data.length; i++) {
            heights.push(data[i][2]);
            timestamps.push(data[i][0]);
        }
        refreshGraph();
    });

// fetch eqution for sine wave
fetch('https://octidesapi.andrewtrackim.com/prediction')
    .then(response => response.json())
    .then(data => {
        a = data['a'];
        b = data['b'];
        c = data['c'];
        h = data['h'];
        refreshGraph();
    });

function refreshGraph() {
    if (heights.length > 0) {

        // generate sine wave starting at minute after most recent data point
        if (a != undefined) {
            startTime = timestamps[timestamps.length - 1] + (60 - timestamps[timestamps.length - 1] % 60);
            for (var i = 0; i < 720; i++) {
                currTime = parseInt(startTime + i * 60);
                newValue = a* Math.sin(b * currTime + c) + h;
                heights.push(newValue);
                timestamps.push(startTime + i * 60);
            }
        }
        

        var data = heights.map(function(height, i) {
            return {x: height, y: timestamps[i]};
        });
        // convert timestamps to date objects to display on graph
        var times = new Array(timestamps.length);
        for (var i = 0; i < times.length; i ++) {
            times[i] = new Date(timestamps[i] * 1000);
        }

        console.log(Math.max(heights));

        let past = document.getElementById('past').getContext('2d');
        let pastChart = new Chart(past, {
            type:'line',
            data:{
                labels: times,
                datasets: [{
                    label: "depth",
                    data: heights
                }]
            },

            options:{
                fill: true,
                borderColor: '#025bba',
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'minute'
                        }
                    }
                }
            }
        });
    }
}