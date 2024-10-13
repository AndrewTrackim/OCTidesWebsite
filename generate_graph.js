// get data from api
var heights = [];
var timestamps = [];
var a, b, c, h;

// get time from 12 hours ago in seconds (14400 seconds to adjust from gmt to est, 43200 seconds to adjust for 12 hours)
var now = parseInt(Date.now() / 1000) - 14400 - 43200;
let checkbox = document.getElementById("futureCheckbox");
let pastChart;


// fetch points form past 12 hours
fetch('https://octidesapi.andrewtrackim.com/get-depth-since/' + now)
    .then(response => response.json())
    .then(data => {
        points = data['tidePoints'];
        for (var i = 0; i < points.length; i++) {
            heights.push(points[i]['depth']);
            timestamps.push(points[i]['unixTime']);
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
        offset = data['offset'];
        refreshGraph();
    });

checkbox.addEventListener( "change", () => {
    refreshGraph();
    console.log("checked"); 
});

function refreshGraph() {
    if (heights.length > 0) {
        predictedHeights = [];
        predictedTimestamps = [];

        // generate sine wave starting at minute after most recent data point
        if (a != undefined && checkbox.checked) {
            startTime = timestamps[timestamps.length - 1] + (60 - timestamps[timestamps.length - 1] % 60);
            for (var i = 0; i < 720; i++) {
                currTime = parseInt(startTime + i * 60 - offset);
                newValue = a* Math.sin(b * currTime + c) + h;
                predictedHeights.push(newValue);
                predictedTimestamps.push(startTime + i * 60);
            }
        }
        
        allHeights = heights.concat(predictedHeights);
        allTimestamps = timestamps.concat(predictedTimestamps);

        var data = allHeights.map(function(height, i) {
            return {x: height, y: allTimestamps[i]};
        });
        // convert timestamps to date objects to display on graph
        var times = new Array(allTimestamps.length);
        for (var i = 0; i < times.length; i ++) {
            times[i] = new Date(allTimestamps[i] * 1000);
        }

        let past = document.getElementById('past').getContext('2d');
        // destroy previous chart
        if (pastChart != undefined) {
            pastChart.destroy();
        }
        pastChart = new Chart(past, {
            type:'line',
            data:{
                labels: times,
                datasets: [{
                    label: "depth",
                    data: allHeights
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