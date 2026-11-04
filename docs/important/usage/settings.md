# Settings

The extension settings that control the HTTP server and its port.

The extension has the following settings which you can use to configure it:

- `restRemoteControl.enable`: enable/disable this extension
- `restRemoteControl.port`: set the port number on which the HTTP server will listen, otherwise the extension will pick one available port for you based on the current workspace path. The `HACKER_REST_CONTROL_PORT` environment variable overrides this setting.
- `restRemoteControl.fallbacks`: an array of port numbers to fallback to if the port is already in use.
