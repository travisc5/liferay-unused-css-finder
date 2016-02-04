/* run commander component
 * To use add require('../cmds/run.js')(program) to your commander.js based node executable before program.parse
 */

var _ = require('lodash');
var cheerio = require('cheerio');
var childProcess = require('child_process');
var configUtil = require('../lib/configUtil');
var crawler = require("simplecrawler");
var css = require('css');
var fs = require('fs-extra');
var Handlebars = require('handlebars');
var inquirer = require('inquirer');
var liferay = require('liferay-connector');
var path = require('path');
var phantomjs = require('phantomjs-prebuilt');
var program = require('commander');
var ProgressBar = require('progress');
var request = require('request');

var config = configUtil.getCurrentInstanceConfig();
var handlebars_data = {};
var resultsFile = fs.createOutputStream('./output/results.html');
var resultsTemplate = fs.readFileSync('./templates/results.hbs', 'utf8');
var template = Handlebars.compile(resultsTemplate);

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
	var layouts = session.sessionLayouts;
	var pseudoCSSRemoved = [];
	var urlsToTest = [];

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

	return searchPageForCSS(session);
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
	console.log();

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
				var themeCSS = css.parse(body);

				session.themeCSSFileSize = size;

				_.forEach(
					themeCSS.stylesheet.rules,
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

	__request(
		session.sessionURLtoTest,
		function(responses) {
			var index = 0;

			for (url in responses) {
				var currentResponse = responses[url];

				session.sessionProgress.tick();

				index++;

				if (index == session.sessionURLtoTest.length) {
					session.sessionUnusedCSS = _.uniq(unusedCSSSelectors);

					handlebars_data.unused_css = session.sessionUnusedCSS;
					// handlebars_data.unused_css = [];

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
										if (selector.search(/\:(?:ho)\w+|\:(?:fo)\w+|\:(?:be)\w+|\:(?:aft)\w+/) == -1) {
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

module.exports = function(program) {
	program
	.command('run')
	.version('0.0.0')
	.description('Runs the lucf using the current selected configuraiton')
	.action(
		function() {
			liferay.authenticate(
				basePath,
				userInfo,
				function (err, session) {
					if (err) {
						throw(err.message);
					}
					else {
						promptSites(session);
					}
				}
			);
		}
	);
};
