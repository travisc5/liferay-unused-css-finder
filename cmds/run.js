/* run commander component
 * To use add require('../cmds/run.js')(program) to your commander.js based node executable before program.parse
 */

var _ = require('lodash');
var configUtil = require('../lib/configUtil');
var Crawler = require("js-crawler");
var fs = require('fs-extra');
var inquirer = require('inquirer');
var liferay = require('liferay-connector');
var program = require('commander');
var request = require('request');

var config = configUtil.getCurrentInstanceConfig();
var crawler = new Crawler().configure({ignoreRelative: false, depth: 2});

var basePath = [
	'http://',
	config.host + ':',
	config.port
].join('');

var userInfo = {
	login: config.username + '@' + config.mailDomain,
	password: config.password
};

module.exports = function(program) {
	function crawlSites(session) {
		var url = session.sessionGroupURL;
		crawler.crawl(
			{
				url: url,
				success: function(page) {},
				failure: function(page) {
					console.log(page);
				},
				finished: function(crawledUrls) {
					console.log(crawledUrls);
				}
			}
		);
	}

	function getGroupInfo(session) {
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
							'/web' + group.friendlyURL + '/'
						].join('');

						session.sessionGroupURL = groupURL;

						getLayouts(session);

						// getTheme(session);
					}
				}
			}
		);
	}

	function getLayouts(session) {
		var question = {type: 'confirm', name: 'isPrivateLayout', message: 'Is the selected Group a private group?', default: false};

		inquirer.prompt(
			question,
			function(answers) {
				return session.sessionIsPrivateLayout = answers.isPrivateLayout;
			}
		);

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

					getTheme(session);
				}
			}
		);
	}

	function getTheme(session) {
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
				}
			}
		);

		var question = {type: 'list', name: 'theme', choices: session.sessionThemeChoices, message: 'Which theme should we use?'};

		inquirer.prompt(
			question,
			function(answers) {
				var cssPath = [
					basePath + '/',
					answers.theme + '/css/',
					config.cssFile + '?minifierType=css'
				].join('');

				session.sessionCSSPath = cssPath;

				saveCSSLocal(session);
			}
		);
	}

	function saveCSSLocal(session) {
		console.log(session);
		request(
			session.sessionCSSPath,
			function (err, response, body) {
				if (err) {
					throw err;
				}
				else if (!err && response.statusCode == 200)  {
					session.sessionCSSContent = body;

					crawlSites(session);
				}
			}
		);
	}

	function promptSites(session) {
		var siteChoices = [];
		var processObject = {};

			_.forEach(
				session.sites,
				function(site) {
					if (site.active) {
						var obj = {};

						obj.value = site.groupId;
						obj.name = site.name;

						siteChoices.push(obj);
					}
				}
			);

		var question = {type: 'list', name: 'groupId', choices: siteChoices, message: 'Which site should be analyzed?'};

		inquirer.prompt(
			question,
			function(answers) {
				session.sessionGroupId = answers.groupId;

				getGroupInfo(session);
			}
		);
	}

	program
		.command('run')
		.version('0.0.0')
		.description('Runs the lucf using the current selected configuraiton')
		.action(function() {
			liferay.authenticate(
				basePath,
				userInfo,
				function (err, session) {
					if (err) {
						throw(err);
					}
					else {
						promptSites(session);
					}
				}
			);
		});
};
