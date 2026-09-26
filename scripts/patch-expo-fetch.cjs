/** Ensure immediate native policy rejection reaches Expo fetch's promise. */
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(path.dirname(require.resolve('expo/package.json')),
  'android/src/main/java/expo/modules/fetch/NativeRequest.kt');
const source = fs.readFileSync(file, 'utf8');
const original = `    this.task = newClient.newCall(request)
    this.task?.enqueue(this.response)
    response.onStarted()`;
const replacement = `    this.task = newClient.newCall(request)
    // Native policy interceptors may reject synchronously on the dispatcher.
    // Publish STARTED before callbacks can observe the response state.
    response.onStarted()
    this.task?.enqueue(this.response)`;
if (source.includes(original)) {
  fs.writeFileSync(file, source.replace(original, replacement));
  console.info('[android-build] Applied Expo fetch immediate-rejection ordering fix');
} else if (!source.includes(replacement)) {
  throw new Error('Expo fetch source changed; review and retire the callback ordering patch before building');
}
