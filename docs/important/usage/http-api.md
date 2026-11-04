# HTTP API

How the server starts, how the port is chosen, and how to invoke commands over HTTP.

When you install this extension, it will automatically try to start a HTTP server. The port can be specified with VSCode setting `restRemoteControl.port`. When you are going to use multiple VSCode sessions at the same time, it is best to configure it at workspace level or use the `restRemoteControl.fallbacks` setting to specify fallback ports when the specified one is already in use. VSCode terminals opened will have environment variable `REMOTE_CONTROL_PORT` set with the port the server is currently listening on.

The port can also be pinned with the `HACKER_REST_CONTROL_PORT` environment variable. It takes precedence over the `restRemoteControl.port` setting, which makes it the reliable choice for containers and automated environments (for example, set it in `docker-compose.yml` so the endpoint is always the same).

![status bar listening message](../../../assets/statusbar-item.png)


Once installed, you can execute vscode `commands` by making HTTP requests. The HTTP verb is currently ignored. Here are few examples using `curl`, assuming VSCode is listening on port `37100`:

```bash
# Create a new terminal
curl http://localhost:37100 -d '{"command":"workbench.action.terminal.new"}'
# or curl http://localhost:37100/?command=workbench.action.terminal.new

# Run `pwd` in the currently active terminal
curl http://localhost:37100 -d '{"command":"custom.runInTerminal", "args": ["pwd"]}'
# or curl http://localhost:37100/?command=custom.runInTerminal&args=%5B%22pwd%22%5D

# Kill all terminals
curl http://localhost:37100 -d '{"command":"workbench.action.terminal.killAll"}'
# or curl http://localhost:37100/?command=workbench.action.terminal.killAll

# Register an external formatter endpoint available at http://localhost:12345 that accepts POST requests and formats C++ and Python code
curl http://localhost:37100 -d '{"command":"custom.registerExternalFormatter", "args":["http://localhost:12345", ["cpp", "python"], "POST"]}'
```

All requests are expected to be in a JSON HTTP request body in the form:
```json
{
  "command": "<command-id>",
  "args": ["<arg1>", "<arg2>", "...", "<argN>"]
}
```
or URL encoded as `?command=<command-id>&args=<url-encoded-of-json-string-of-args>`.

Some VSCode commands expect VSCode's defined types such as [Range](https://code.visualstudio.com/api/references/vscode-api#Range), [Uri](https://code.visualstudio.com/api/references/vscode-api#Uri), [Position](https://code.visualstudio.com/api/references/vscode-api#Position) and [Location](https://code.visualstudio.com/api/references/vscode-api#Location). To accommodate for those, such arguments can be passed as a special types, see the example below which effectively invokes `editor.action.goToLocations` with `Uri`, `Position` and an array of `Location`s:

```json
{
  "command": "editor.action.goToLocations",
  "args": [
    {
      "__type__": "Uri",
      "args": ["/path/to/file.py"]
    },
    {
      "__type__": "Position",
      "args": [4, 0]
    },
    [
      {
        "__type__": "Location",
        "args": [
          {
            "__type__": "Uri",
            "args": ["/path/to/file.py"]
          },
          {
            "__type__": "Position",
            "args": [11, 5]
          }
        ]
      }
    ]
  ]
}
```
