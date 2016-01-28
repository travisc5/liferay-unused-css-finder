/* instance-config commander component
 * To use add require('../cmds/instance-config.js')(program) to your commander.js based node executable before program.parse
 */
'use strict';

var _ = require('lodash');
var inquirer = require('inquirer');
var program = require('commander');

var configUtil = require('../lib/configUtil');

var actions = {
	addInstanceAnswer: 'ADD a new portal instance configuration.',
	editInstanceAnswer: 'EDIT a portal instance configuration.',
	deleteInstanceAnswer: 'DELETE a portal instance configuration.',
	listInstancesAnswer: 'LIST current portal instance configurations.',
	useInstanceAnswer: 'USE a different portal instance configuration.'
};

var instanceConfigList = configUtil.getInstanceConfigList();

var whichActionQuestion = {
	type: 'list',
	name: 'action',
	message: 'What would you like to do?',
	choices: _.values(actions)
};

module.exports = function(program) {
	function addInstance() {
		var defaultName = 'Instance config ' + instanceConfigList.length;
		var defaultUserName = 'test';
		var defaultPassword = 'test';
		var defaultMailDomain = 'liferay.com';
		var defaultHost = 'localhost';
		var defaultPort = '8080';
		var defaultCSS = 'custom.css';

		configureInstance(defaultName, defaultUserName, defaultPassword, defaultMailDomain, defaultHost, defaultPort, defaultCSS);
	}

	function configureInstance(defaultName, defaultUserName, defaultPassword, defaultMailDomain, defaultHost, defaultPort, defaultCSS) {
		var questions = [
			{ name: 'instanceName', message: 'What would you like to name this instance configuration?', default: defaultName },
			{ name: 'userName', message: 'Username or email address?', default: defaultUserName },
			{ name: 'password', message: 'Password?', default: defaultPassword },
			{ name: 'mailDomain', message: 'Mail domain?', default: defaultMailDomain },
			{ name: 'host', message: 'Host?', default: defaultHost },
			{ name: 'port', message: 'Port?', default: defaultPort },
			{ name: 'cssFile', message: 'What is your custom css file name?', default: defaultCSS },
		];

		// This removes the name question, making sure that 'default' is always named 'default'
		if (defaultName === 'default') {
			questions.shift();
		}

		inquirer.prompt(questions, function(answers) {
			if (defaultName != 'default') {
				configUtil.deleteInstanceConfig(defaultName);
			}

			var configName = answers.instanceName || defaultName;

			configUtil.setInstanceConfig(
				configName,
				answers.userName,
				answers.password,
				answers.mailDomain,
				answers.host,
				answers.port,
				answers.cssFile
			);

			// Updates the currentInstanceConfig parmeter
			// Makes sure that editing the currently used config does not make it unusable
			if (defaultName === configUtil.getCurrentInstanceName) {
				configUtil.setCurrentInstanceConfig(configName);
			}
		});
	}

	function deleteInstance(instanceName) {
		instanceName = instanceName || program.args[1];
		var instanceConfig = configUtil.getInstanceConfig(instanceName);

		if (instanceName && !!instanceConfig) {
			configUtil.deleteInstanceConfig(instanceName);
		}
		else {
			var deleteInstanceQuestion = {
				type: 'list',
				name: 'instanceName',
				message: 'Which instance configuration would you like to delete?',
				choices: instanceConfigList
			};

			inquirer.prompt([deleteInstanceQuestion], function(answers) {
				if (answers.instanceName != 'default') {
					configUtil.deleteInstanceConfig(answers.instanceName);
				}
				else {
					console.log('You cannot delete the default instance configuration.');
				}
			});
		}
	}

	function editInstance() {
		var instanceName = program.args[1];
		var instanceConfig = configUtil.getInstanceConfig(instanceName);

		if (instanceName && !!instanceConfig) {
			configureInstance(instanceName, instanceConfig.username, instanceConfig.password, instanceConfig.mailDomain, instanceConfig.host, instanceConfig.port, instanceConfig.cssFile);
		}
		else {
			var editInstanceQuestion = {
				type: 'list',
				name: 'instanceName',
				message: 'Which instance configuration would you like to edit?',
				choices: instanceConfigList
			};

			inquirer.prompt([editInstanceQuestion], function(answers) {
				instanceName = answers.instanceName;
				instanceConfig = configUtil.getInstanceConfig(instanceName);

				configureInstance(instanceName, instanceConfig.username, instanceConfig.password, instanceConfig.mailDomain, instanceConfig.host, instanceConfig.port, instanceConfig.cssFile);
			});
		}
	}

	function listInstances() {
		console.log('');
		_.forEach(configUtil.getInstanceConfigs(), function(instance, instanceName) {
			var appendix = ':';

			if (instanceName === configUtil.getCurrentInstanceName()) {
				appendix = ' (ACTIVE):';
			}

			console.log(instanceName + appendix);
			console.log(instance);
			console.log('');
		});
	}

	function routeAction(action) {
		switch (action) {
			case 'add':
			case actions.addInstanceAnswer:
				addInstance();
				break;

			case 'edit':
			case actions.editInstanceAnswer:
				editInstance();
				break;

			case 'delete':
			case actions.deleteInstanceAnswer:
				deleteInstance();
				break;

			case 'list':
			case actions.listInstancesAnswer:
				listInstances();
				break;

			case 'use':
			case actions.useInstanceAnswer:
				useInstance();
				break;
		}
	}

	function useInstance() {
		var instanceName = program.args[1];
		var instanceConfig = configUtil.getInstanceConfig(instanceName);

		if (instanceName && !!instanceConfig) {
			configUtil.setCurrentInstanceConfig(instanceName);
		}
		else {
			var useInstanceQuestion = {
				type: 'list',
				name: 'instanceName',
				message: 'Which instance configuration would you like to use?',
				choices: instanceConfigList
			};

			inquirer.prompt([useInstanceQuestion], function(answers) {
				configUtil.setCurrentInstanceConfig(answers.instanceName);
			});
		}
	}

	program
		.command('instance-config')
		.version('0.0.0')
		.description('Create a instance-config to be used with lucf')
		.action(function (/* Args here */) {
			inquirer.prompt([whichActionQuestion], function(answers) {
				routeAction(answers.action);
			});
		});
};
