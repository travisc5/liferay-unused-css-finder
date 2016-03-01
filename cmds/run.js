/* run commander component
 * To use add require('../cmds/run.js')(program) to your commander.js based node executable before program.parse
 */

var _ = require('lodash');
var configUtil = require('../lib/configUtil');
var css = require('css');
var fs = require('fs-extra');
var Handlebars = require('handlebars');
var jsdom = require("jsdom");
var inquirer = require('inquirer');
var liferay = require('liferay-connector');
var program = require('commander');
var ProgressBar = require('progress');
var request = require('request');
var Crawler = require('js-crawler');
var Spinner = require('cli-spinner').Spinner;

var config = configUtil.getCurrentInstanceConfig();
var handlebars_data = {};
var resultsFile = fs.createOutputStream('./output/results.html');
var resultsTemplate = fs.readFileSync('./templates/results.hbs', 'utf8');
var template = Handlebars.compile(resultsTemplate);

var analyzeCSSResults = function(session) {
	var unusedPercent = Math.round((session.sessionUnusedCSS.length / session.sessionAllCSS.length) * 100);

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
	
	console.log(session.sessionUnusedCSS.length, session.sessionParseCSS.length);
	console.log('Great! Please see \'../output/results.html\'');
	
	writeTemplateData(handlebars_data);

	return process.exit();
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

		searchForCSS(session);
	}
	else {
		var urlsToTest = [];
		
		var crawler = new Crawler().configure(
			{
  				depth: 3
			}
		);
		
		var spinner = new Spinner('Grabbing URL\'s from \'' + session.sessionBaseURL + '\'.. %s');
		
		spinner.setSpinnerString('|/-\\');
		
		spinner.start();
		
		crawler.crawl(
			session.sessionBaseURL, 
			function onSuccess(page) {
				var url = page.url;
				
				if (url.indexOf(session.sessionBaseURL) >= 0) {
					urlsToTest.push(url)
				}
			},
			null,
			function onAllFinished(crawledUrls) {
				spinner.stop();
				
				console.log('');
				console.log('Done!');
				
				session.sessionURLtoTest = _.uniq(urlsToTest);
				
				searchForCSS(session);
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

var initializeProgressBar = function(len, message) {
	var bar = new ProgressBar(
		message,
		{
			complete: '=',
			callback: function() {
				console.log();
				console.log();
			},
			incomplete: ' ',
			width: 75,
			total: len
		}
	);

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
				var parsedCSS = css.parse(body);

				_.forEach(
					parsedCSS.stylesheet.rules,
					function(rule) {
						if (rule.type == 'rule') {
							cssTempArray.push(rule.selectors);
						}
					}
				);

				cssTempArray = _.flatten(cssTempArray, true);
				
				cssTempArray = _.remove(
					cssTempArray,
					function(selector){
						return selector.search(/::?[^ ,:.]+|(?:\.not\()|(?:\@\-)/) == -1;
					}
				);

				session.sessionParseCSS = _.uniq(cssTempArray);

				return crawlSites(session);
			}
		}
	);
};

var searchForCSS = function(session) {
	console.log('Now we will grab all the HTML');
	
	var allCSS = [];
	var index = 1;
	var unusedCSSSelectors = [];

	var bar = initializeProgressBar(session.sessionURLtoTest.length, 'Crawling Layouts [:bar] :percent :etas');

	_.forEach(
		session.sessionURLtoTest,
		function(url) {
			jsdom.env(
				{
				features: {
					FetchExternalResources: ["script", "frame", "iframe", "link"],
					ProcessExternalResources: ["script"]
				},
				url: url,
				done: function (err, window) {
						if (err) {
							throw err;
						}
						
						var document = window.document;

						if (window.document.readyState === 'complete') {
							_.forEach(
								session.sessionParseCSS,
								function(selector) {
									var node = document.querySelectorAll(selector);

									var length = node.length;
									
									allCSS.push(selector);

									switch (length) {
										case 0:
											unusedCSSSelectors.push(selector);

											break;
										default:

											_.pull(session.sessionParseCSS, selector);

											if (_.includes(unusedCSSSelectors, selector)) {
												_.pull(unusedCSSSelectors, selector);
											}

											break;
									}
								}
							);

							bar.tick();
						}

						index++;

						if (index == session.sessionURLtoTest.length) {
							session.sessionUnusedCSS = _.uniq(unusedCSSSelectors);
							
							session.sessionAllCSS = _.uniq(allCSS);
							
							console.log(allCSS.length, session.sessionParseCSS.length, session.sessionUnusedCSS.length);

							handlebars_data.unused_css = session.sessionUnusedCSS;

							analyzeCSSResults(session);
						}
					}
				}
			);
		}
	)
};

var setTheme = function(session) {
	var question = {type: 'list', name: 'theme', choices: session.sessionThemeChoices, message: 'Which theme should we use?'};

	inquirer.prompt(
		question,
		function(answers) {
			var name = answers.theme;
			var themeName = name.replace(/\-/g, ' ');

			handlebars_data.theme_name = themeName;
			handlebars_data.file_path = session.sessionBaseLiferayPath + '/' + answers.theme + '/css/' + config.cssFile;

			session.sessionCSSPath = [
				session.sessionBaseLiferayPath + '/',
				name + '/css/',
				config.cssFile + '?minifierType=css'
			].join('');

			return saveCSSLocal(session);
		}
	);
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
				session.sessionBaseLiferayPath = basePath;

				return promptSites(session);
			}
		}
	);
};

var setProductionSite = function() {
	var session = {};
	var questions = [
		{ name: 'url', message: 'What site would you like to crawl?', default: 'http://www.jstips.co' },
		{ name: 'cssFile', message: 'What is the URL of the CSS file you would like to use?', default: 'http://www.jstips.co/style.css' }
	];

	inquirer.prompt(
		questions,
		function(answers) {
			var nameRegex = /^(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/\n]+)|^(?:http?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/\n]+)/ig;
									
			handlebars_data.file_name = 'your CSS';
			handlebars_data.file_path = answers.cssFile;
			handlebars_data.theme_name = nameRegex.exec(answers.url)[1];

			session.sessionCSSPath = answers.cssFile;
			session.sessionCrawlDepth = answers.depth;
			session.sessionBaseURL = answers.url;

			return saveCSSLocal(session);
		}
	);
}

var writeTemplateData = function(data) {
	return resultsFile.write(template(handlebars_data));
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
