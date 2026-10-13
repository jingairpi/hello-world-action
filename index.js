import * as core from '@actions/core';

try {
  const nameToGreet = core.getInput('who-to-greet');
  if (/[\r\n]/.test(nameToGreet)) {
    throw new Error('who-to-greet must be a single line');
  }
  console.log(`Hello ${nameToGreet}!`);

  const time = new Date().toTimeString();
  core.setOutput('time', time);
} catch (error) {
  core.setFailed(error.message);
}
