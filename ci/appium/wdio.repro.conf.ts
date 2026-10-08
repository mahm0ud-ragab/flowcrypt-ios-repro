// wdio config for the path-traversal repro spec.
// Runs the official unmodified app in the iOS Simulator with real Gmail OAuth
// (no mock APIs). Camera recording is handled by the workflow via simctl.
import { join } from 'path';
import { config } from './wdio.shared.conf';

config.suites = {
  repro: ['../tests/specs/repro/**/*.spec.ts'],
};

config.capabilities = [
  {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': process.env.SIM_UDID,
    'appium:deviceName': 'iPhone',
    ...(process.env.SIM_IOS_VERSION ? { 'appium:platformVersion': process.env.SIM_IOS_VERSION } : {}),
    'appium:app': join(process.cwd(), './FlowCrypt.app'),
    'appium:newCommandTimeout': 10000,
    'appium:wdaLaunchTimeout': 600000,
    'appium:wdaConnectionTimeout': 600000,
    'appium:simulatorStartupTimeout': 600000,
    'appium:reduceMotion': true,
    'appium:autoAcceptAlerts': true,
  },
];

exports.config = config;
