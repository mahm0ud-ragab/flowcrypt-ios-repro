// wdio config for the path-traversal repro spec.
// Runs the official unmodified app in the iOS Simulator with real Gmail OAuth
// (no mock APIs). Camera recording is handled by the workflow via simctl.
import fs from 'fs';
import { join } from 'path';
import { config } from './wdio.shared.conf';

config.suites = {
  repro: ['../tests/specs/repro/**/*.spec.ts'],
};

// Diagnostics: on any failed test, dump the full UI hierarchy + a screenshot
// into ./tmp (uploaded with the workflow artifacts) so failures are debuggable.
const sharedAfterTest = config.afterTest;
config.afterTest = async function (test, context, result) {
  if (sharedAfterTest) {
    await sharedAfterTest(test, context, result);
  }
  if (result && result.passed === false) {
    try {
      const pageSource = await driver.getPageSource();
      fs.writeFileSync('./tmp/diag-page-source.xml', pageSource);
      console.log('DIAG: page source dumped to ./tmp/diag-page-source.xml');
    } catch (e) {
      console.log('DIAG: failed to dump page source', e);
    }
    try {
      await browser.saveScreenshot(`./tmp/diag-failure-${Date.now()}.png`);
      console.log('DIAG: failure screenshot saved to ./tmp');
    } catch (e) {
      console.log('DIAG: failed to save failure screenshot', e);
    }
  }
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
