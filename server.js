var express = require('express'),
    sys = require('sys'),
    fs = require('fs'),
	listenPort = 3000,
	app = express.createServer(),
    _ = require('./lib/underscore')._,
    mustache = require('mustache'),
	Problem = require('./models/problem').Problem,
    Job = require('./models/job').Job;
    backgroundTasks = require('./background_tasks').backgroundTasks,
    dataa = require("./models/data_abstraction"),
    io = require('socket.io');

var cradle = require('cradle'),
    c = new(cradle.Connection)('maprejuice.couchone.com', 5984, {cache: true, raw: false}),
    db = c.database('maprejuice');

var TEN_MINS_IN_MS = (1000 * 60 * 10);
    
app.configure(function() {
    app.use(express.logger({
        format: ':method :url / :referrer'
    }));
    app.use(express.bodyDecoder());
	
	/*	Magic that makes Mustache work as our templating engine. ;D */
	app.register('.html', {
		render: function(str, obj) {
			return mustache.to_html(str, obj);
		}
	});
    
	//app.set('view engine', 'mustache');

    app.use(express.staticProvider(__dirname + '/public'));

    // set up database if it doesn't exist
    db.exists(function (err, res) {
        if (!res) {
            db.create(function (err, res) {
                // set up problem views
                db.insert('_design/problems', {
                    all: {
                        map: function (doc) {
                            if (doc.type && doc.type == 'problem') {
                                emit(null, doc);
                            }
                        }
                    },
                    queued: {
                        map: function (doc) {
                            if (doc.type && doc.type == 'problem' && doc.status && doc.status == 'queued') {
                                emit(null, doc);
                            }
                        }
                    },
                    running: {
                        map: function (doc) {
                            if (doc.type && doc.type == 'problem' && doc.status && doc.status == 'running') {
                                emit(null, doc);
                            }
                        }
                    },
                    complete: {
                        map: function (doc) {
                            if (doc.type && doc.type == 'problem' && doc.status && doc.status == 'complete') {
                                emit(null, doc);
                            }
                        }
                    }
                });

                // set up problem views
                db.insert('_design/jobs', {
                    all: {
                        map: function (doc) {
                            if (doc.type && doc.type === 'job') {
                                emit(doc.created_at, doc);
                            }
                        }
                    },
                    unfinished: {
                        map: function (doc) {
                            if (doc.type && doc.type === "job"
                                    && doc.status && (doc.status === "queued" || doc.status === "processing")
                                    && !doc.datumId) {
                                // set problem id as key so we can query by this later
                                emit(doc.problem_id, doc);
                            }
                        }
                    },
                    queued: {
                        map: function (doc) {
                            if (doc.type && doc.type === "job" && doc.status && doc.status === "queued") {
                                emit(doc.created_at, doc);
                            }
                        }
                    },
                    stale: {
                        map: function (doc) {
                            if (doc.type && doc.type == 'job'
                                    && doc.status && doc.status == 'processing'
                                    && doc.created_at && doc.created_at < (new Date().getTime() - TEN_MINS_IN_MS)) {
                                emit(doc.created_at, doc);
                            }
                        }
                    }
                });

                // set up problem views
                db.insert('_design/datum', {
                    all: {
                        map: function (doc) {
                            if (doc.type && doc.type === 'datum') {
                                emit(null, doc);
                            }
                        }
                    },
                    intermediate: {
                        map: function (doc) {
                            if (doc.type && doc.type === 'datum'
                                    && doc.dataType && doc.dataType == 'intermediate') {
                                emit(doc.problemId, doc);
                            }

                        }
                    },
                    output: {
                        map: function (doc) {
                            if (doc.type && doc.type === 'datum'
                                    && doc.dataType && doc.dataType == 'output') {
                                emit(doc.problemId, doc);
                            }

                        }
                    }
                });
            });
        }
    });
});


var socketio = io.listen(app);
app.use("/workers", require("./worker_api")(socketio));

/* Redirect to correct URL on every request */
app.get(/.*/, function (req, resp, next) {
    var host = req.header('host');
    var path = req.url;
    if (host == 'www.maprejuice.com' || host == 'anansi.no.de') {
        resp.redirect("http://maprejuice.com"+path, 301);
    } else {
        next();
    }
});

app.get('/compute', function(req, res) {
	res.render('embedded_compute.html', {layout: false});
	/*fs.readFile(process.cwd() + '/views/embedded_compute.html', function(err, data) {
		sys.puts(data);
		res.contentType('text/html');
		res.send(data);
	}); */
});

/* Homepage */
app.get('/', function(req, res) {
    /* Disabled temporarily
	db.view('problems/all',
            function (err, rowSet) {
                var problemsList = [];
                for (var row in rowSet) {
                    var p = new Problem(rowSet[row].value);
                    problemsList.push(p);
                }
                res.render('index.html', { problems: problemsList });
            }); */
	res.render('index.html');
});

/* This is a stub, please expand it. */
app.get('/recently_solved', function(req, resp) {
    db.view('problems/complete', {limit: 5}, function (err, rowSet) {
        sys.puts(sys.inspect(rowSet));
        if (err) {
            resp.send(JSON.stringify([]));
        } else {
            var results = [];
            for (var i in rowSet) {
                results.push({name: rowSet[i].value.name, percentage: "100%", url: "/problem/"+rowSet[i].id});
            }
            resp.send(JSON.stringify(results));
        }
    });
//	res.send(JSON.stringify([
//		{name: "Jonas Algorithm", percentage: "88", url: "/"},
//		{name: "Brandon Account", percentage: "18", url: "/"},
//		{name: "Ryan Theories", percentage: "95", url: "/"},
//		{name: "Tons of Sharks", percentage: "38", url: "/"},
//		{name: "Traveling Salesman", percentage: "0", url: "/"}
//	]));
});

app.get('/about', function(req, res) {
	res.render('about.html');
});

app.get('/contact', function(req, res) {
	res.render('contact.html');
});

/* Form to create problem */
app.get('/problem', function(req, res) {
	// TODO create object here
    res.render('problem/new.html', {
        problem: new Problem({})
    });
});

/* This is where the problem is actually created */
app.post('/problem', function(req, resp) {
    // TODO sanitize the shit out of this. Make sure it's valid js etc
    var p = new Problem(req.body);
    if (p.validate()) {
        dataa.saveProblem(p, function (err, result) {
            resp.redirect('/problem/' + result.id);
        });
     } else {
		p.stringed_data = "";
		
		try {
			var attemptedStringify = JSON.stringify(p.data).split('');
			attemptedStringify[0] = '';
			attemptedStringify[attemptedStringify.length - 1] = '';
			p.stringed_data = attemptedStringify.join('');
		} catch(e) {}
        
		resp.render('problem/new.html', {
            problem: p
        });
    }
});

/* Get a specific problem */
app.get('/problem/:id', function(req, resp) {
    // get object
    dataa.findProblem(req.params.id, function (err, problem) {
        if (err) {
            resp.redirect('/');
        } else {
//            console.log(sys.inspect(problem));
            problem.initial_data = JSON.stringify(problem.data);
            problem.is_queued = function() { return problem.status === 'queued'; };
            
            resp.render('problem/show.html', {
                problem: problem
            });
        }
    });
});

app.get('/problem/:id/results', function(req, resp) {
    // get object
    dataa.findProblem(req.params.id, function (err, problem) {
        if (err) {
            resp.send({});
        } else {
            db.view('datum/output', { key: problem.id }, function (err, rowSet) {
                var results = {};
                for (var i in rowSet) {
                    var row = rowSet[i].value;
                    results[row.key] = row.values;
                }
				resp.contentType("text/html");
                resp.send(JSON.stringify(results));
            });
        }
    });
});



/* Kick off the specified problem by queing up all the jobs for it */
app.get('/problem/:id/start', function(req, resp) {
    // get object
    db.get(req.params.id, function (err, result) {
        var p = new Problem(result);
        // only start the job if it isn't already running
        if (!(p.status === 'running')) {
            var input_data = p.data;
            for (var key in input_data) {
                var inp = {};
                inp.key = key;
                inp.value = input_data[key];
                var job = new Job({
                    problem_id: p.id,
                    input: inp,
                    algorithm: p.map_function,
                    algorithm_type: 'map'
                });
                console.log("starting job for problem " + p.id + " and key " + key);
                sys.puts(sys.inspect(job));
                if (job.validate()) {
                    db.insert(job, function (err, result) {
                        sys.puts("insert job "+result.id);
                    });
                }
            }

            p.status = 'running';
            dataa.saveProblem(p, function (err, result) {
                sys.puts("save status => " + sys.inspect(result));
                resp.redirect('/problem/'+req.params.id);
            });
        } else {
            resp.redirect('/problem/'+req.params.id);
        }
    });
});

/* Homepage */
app.get('/jobs', function(req, res) {
    db.view('jobs/all',
            function (err, rowSet) {
                var jobsList = [];
                for (var row in rowSet) {
                    var job = new Job(rowSet[row].value);
                    jobsList.push(job);
                }
                res.render('job/list.html', {
                    jobs: jobsList
                });
            });
});
app.get('/jobs/queued', function(req, res) {
    db.view('jobs/queued',
            function (err, rowSet) {
                var jobsList = [];
                for (var row in rowSet) {
                    var job = new Job(rowSet[row].value);
                    jobsList.push(job);
                }
                res.render('job/list.html', {
                    jobs: jobsList
                });
            });
});

app.get('/code', function(req, resp) {
    resp.render('code.html');
});


// Listen on 80? Really?
app.listen(parseInt(process.env.PORT || listenPort));
