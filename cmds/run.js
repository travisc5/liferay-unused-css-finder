/* run commander component
 * To use add require('../cmds/run.js')(program) to your commander.js based node executable before program.parse
 */

var _ = require('lodash');
var cheerio = require('cheerio');
var childProcess = require('child_process');
var configUtil = require('../lib/configUtil');
var css = require('css');
var fs = require('fs-extra');
var Handlebars = require('handlebars');
var inquirer = require('inquirer');
var liferay = require('liferay-connector');
var path = require('path');
var program = require('commander');
var ProgressBar = require('progress');
var Promise = require("bluebird");
var request = require('request');
var url = require("url");

var config = configUtil.getCurrentInstanceConfig();
var handlebars_data = {};
var resultsFile = fs.createOutputStream('./output/results.html');
var resultsTemplate = fs.readFileSync('./templates/results.hbs', 'utf8');
var template = Handlebars.compile(resultsTemplate);

if (!Array.prototype.includes) {
	Array.prototype.includes = function(searchElement /*, fromIndex*/ ) {
		'use strict';
		var O = Object(this);
		var len = parseInt(O.length) || 0;

		if (len === 0) {
			return false;
		}

		var n = parseInt(arguments[1]) || 0;
		var k;

		if (n >= 0) {
			k = n;
		}
		else {
			k = len + n;
			if (k < 0) {
				k = 0;
			}
		}

		var currentElement;

		while (k < len) {
			currentElement = O[k];
			if (searchElement === currentElement ||
			(searchElement !== searchElement && currentElement !== currentElement)) { // NaN !== NaN
				return true;
		 	 }
		 	k++;
		}

		return false;
	};
}

var analyzeCSSResults = function(session) {
	var unusedPercent = Math.round((session.sessionUnusedCSS.length / session.sessionParseCSS.length) * 100);

	handlebars_data.percent = unusedPercent;

	if (unusedPercent >= 15) {
		handlebars_data.condition = 'danger';
	}
	else if ((unusedPercent >= 10) && (unusedPercent < 15)) {
		handlebars_data.condition = 'warning';
	}
	else {
		handlebars_data.condition = 'good';
	}

	return resultsFile.write(template(handlebars_data));
}

var crawlSites = function(session) {
	var pseudoCSSRemoved = [];
	var urlsToTest = [];
	var layouts;

	if (handlebars_data.type == 'local') {
		layouts = session.sessionLayouts;

		_.forEach(
			layouts,
			function(layout) {
				var url = [
					session.sessionGroupURL,
					layout.value
				].join('');

				urlsToTest.push(url);
			}
		);

		session.sessionURLtoTest = urlsToTest;

		initializeProgressBar(session.sessionURLtoTest.length, session);

		searchPageForCSS(session);
	}
	else {
		var urlsToTest = [];

		request(
			session.sessionBaseURL,
			function(err, response, html) {
				if (err) {
					throw err;
				}
				if (!err && response.statusCode == 200) {
					var $ = cheerio.load(html);

					var links = $('a');

					var index = 1;

					if (links.length > 0) {
						links.each(
							function() {
								if (index == session.sessionNumberOfPagesToCrawl) {
									console.log("Done fetching URLs to test");
									console.log();

									return false;
								}
								else {
									var href = $(this).attr('href');

									if (href !== undefined) {
										href = href.trim();

										href = href.split("?")[0];

										if (href != '') {
											if (href.indexOf(session.sessionBaseURL) != -1) {
												if (!urlsToTest.includes(href)) {
													urlsToTest.push(href);

													index++;
												}
											}

											if (href.startsWith('/') && href.indexOf('//') == -1) {
												href = session.sessionBaseURL + href;

												if (!urlsToTest.includes(href)) {
													urlsToTest.push(href);

													index++;
												}
											}
										}
									}
								}
							}
						);

						urlsToTest = _.uniq(urlsToTest);

						session.sessionURLtoTest = urlsToTest;

						initializeProgressBar(session.sessionURLtoTest.length, session);

						searchPageForCSS(session);
					}
					else {
						console.log('No links on given page');

						return false;
					}
				}
			}
		);


	}
};


var getGroupInfo = function(session) {
	session.invoke(
		{
			'/group/get-group' : {
				groupId: session.sessionGroupId
			}
		},
		function(err, group) {
			if (err) {
				throw err;
			}
			else {
				if (group.friendlyURL) {
					var groupURL = [
						'http://',
						config.host + ':',
						config.port,
						'/web' + group.friendlyURL
					].join('');

					session.sessionGroupURL = groupURL;

					return isPrivateLayout(session);
				}
			}
		}
	);
};

var getLayouts = function(session) {
	session.invoke(
		{
			'/layout/get-layouts':
			{
				groupId: session.sessionGroupId,
				privateLayout: session.sessionIsPrivateLayout
			},
		},
		function(err, layouts) {
			if (err) {
				throw err;
			}
			else {
				var flatLayouts = [];

				_.forEach(
					layouts,
					function(layout) {
						var obj = {};

						if (!layout.hidden) {
							obj.name = layout.nameCurrentValue;
							obj.value = layout.friendlyURL;

							flatLayouts.push(obj);
						}
					}
				);

				session.sessionLayouts = flatLayouts;

				return getTheme(session);
			}
		}
	);
};

var getTheme = function(session) {
	var themeChoices = [];

	session.invoke(
		{
			'/theme/get-war-themes' : {}
		},
		function(err, themes) {
			if (err) {
				throw err;
			}
			else {
				_.forEach(
					themes,
					function(theme) {
						var obj = {};

						obj.value = theme.servlet_context_name;
						obj.name = theme.theme_name;

						themeChoices.push(obj);

						session.sessionThemeChoices = themeChoices;
					}
				);

				return setTheme(session);
			}
		}
	);
};

var initializeProgressBar = function(len, session) {
	var bar = new ProgressBar(
		'Crawling Layouts [:bar] :percent :etas',
		{
			complete: '=',
			callback: function() {
				console.log();
				console.log("Completed! Please see '/output/results.html");
			},
			incomplete: ' ',
			width: 75,
			total: len
		}
	);

	session.sessionProgress = bar;

	return bar;
};

var isPrivateLayout = function(session) {
	var question = {type: 'confirm', name: 'isPrivateLayout', message: 'Is the selected Group a private group?', default: false};

	inquirer.prompt(
		question,
		function(answers) {
			session.sessionIsPrivateLayout = answers.isPrivateLayout;

			return getLayouts(session);
		}
	);
};

var promptSites = function(session) {
	var siteChoices = [];

	_.forEach(
		session.sites,
		function(site) {
			if (site.active) {
				var tempObj = {};

				tempObj.value = site.groupId;
				tempObj.name = site.name;

				siteChoices.push(tempObj);
			}
		}
	);

	var question = {type: 'list', name: 'groupId', choices: siteChoices, message: 'Which site should be analyzed?'};

	inquirer.prompt(
		question,
		function(answers) {
			session.sessionGroupId = answers.groupId;

			return getGroupInfo(session);
		}
	);
};

var saveCSSLocal = function(session) {
	request(
		session.sessionCSSPath,
		function (err, response, body) {
			if (err) {
				throw err;
			}
			else if (!err && response.statusCode == 200)  {
				var cssTempArray = [];
				var size = parseInt(response.headers['content-length'], 10);
				var fetchedCSS = css.parse(body);

				session.fetchedCSSFileSize = size;

				_.forEach(
					fetchedCSS.stylesheet.rules,
					function(rule) {
						if (rule.type == 'rule') {
							var tempRuleObj = {};

							tempRuleObj.selectors = rule.selectors;

							var declartionArray = [];

							_.forEach(
								rule.declarations,
								function(declarations) {
									declartionArray.push(declarations.property + ': ' + declarations.value);
								}
							);

							tempRuleObj.declarations = declartionArray;

							cssTempArray.push(tempRuleObj);
						}
					}
				);

				session.sessionParseCSS = cssTempArray;

				return crawlSites(session);
			}
		}
	);
};

var searchPageForCSS = function(session) {
	var unusedCSSSelectors = [];

	if (handlebars_data.type == 'production') {
		console.log('Now let\'s analyze these URLs!');
		console.log('Sit back, this may take some time.');
	}

	__request(
		session.sessionURLtoTest,
		function(responses) {
			var index = 0;

			for (url in responses) {
				var currentResponse = responses[url];

				session.sessionProgress.tick();

				index++;

				if (index === session.sessionURLtoTest.length) {
					session.sessionUnusedCSS = _.uniq(unusedCSSSelectors);

					handlebars_data.unused_css = session.sessionUnusedCSS;

					return analyzeCSSResults(session);
				}
				else {
					if (currentResponse.body) {
						_.forEach(
							session.sessionParseCSS,
							function(object) {
								_.forEach(
									object.selectors,
									function(selector) {
										if (selector.search(/:{1,2}|(?:\.not\()/) == -1) {
											var $ = cheerio.load(currentResponse.body);

											if ($(selector).length == 0) {
												unusedCSSSelectors.push(object);
											}
										}
									}
								);
							}

						);
					}
				}
			}
		}
	);
};

var setTheme = function(session) {
	var question = {type: 'list', name: 'theme', choices: session.sessionThemeChoices, message: 'Which theme should we use?'};

	inquirer.prompt(
		question,
		function(answers) {
			var name = answers.theme;
			var themeName = name.replace(/\-/g, ' ');

			handlebars_data.theme_name = themeName;
			handlebars_data.file_path = basePath + '/' + answers.theme + '/css/' + config.cssFile;

			session.sessionCSSPath = [
				basePath + '/',
				name + '/css/',
				config.cssFile + '?minifierType=css'
			].join('');

			return saveCSSLocal(session);
		}
	);
};

var __request = function (urls, callback) {
	'use strict';

	var results = {};
	var t = urls.length;
	var c = 0;

	var handler = function (error, response, body) {
		var url = response.request.uri.href;

		results[url] = {
			error: error,
			response: response,
			body: body
		};

		if (++c === urls.length) {
			callback(results);
		}
	};

	while (t--) {
		request(urls[t], handler);
	}
};

var setLiferaySession = function() {
	var basePath = [
		'http://',
		config.host + ':',
		config.port
	].join('');

	var userInfo = {
		login: config.username + '@' + config.mailDomain,
		password: config.password
	};

	handlebars_data.file_name = config.cssFile;

	liferay.authenticate(
		basePath,
		userInfo,
		function (err, session) {
			if (err) {
				throw(err.message);
			}
			else {
				return promptSites(session);
			}
		}
	);
};

var setProductionSite = function() {
	var session = {};
	var questions = [
		{ name: 'url', message: 'What site would you like to crawl?', default: 'https://twitter.com' },
		{ name: 'cssFile', message: 'What is the URL of the CSS file you would like to use?', default: 'https://abs.twimg.com/a/1454375955/css/t1/twitter_core.bundle.css' },
		{ name: 'numberPages', message: 'How many pages would you like to crawl (this tool will take longer to run the more pages you analyze)?', default: 10 },
	];

	inquirer.prompt(
		questions,
		function(answers) {
			handlebars_data.file_name = 'your CSS';
			handlebars_data.file_path = answers.cssFile;
			handlebars_data.theme_name = answers.url;

			session.sessionCSSPath = answers.cssFile;
			session.sessionCrawlDepth = answers.depth;
			session.sessionBaseURL = answers.url;
			session.sessionNumberOfPagesToCrawl = answers.numberPages

			return saveCSSLocal(session);
		}
	);
}

module.exports = function(program) {
	program
	.command('run')
	.version('0.0.0')
	.description('Runs the lucf using the current selected configuraiton')
	.action(
		function() {
			var choices = [
				"Local",
				"Production"
			];

			var question = {type: 'list', name: 'type', choices: choices, message: 'Are you checking a Local instance or a Production website?'};

			inquirer.prompt(
				question,
				function(answers) {
					var type = answers.type.toLowerCase();

					handlebars_data.type = type;

					if (type == 'local') {
						return setLiferaySession();
					}
					else {
						return setProductionSite();
					}
				}
			);
		}
	);
};
