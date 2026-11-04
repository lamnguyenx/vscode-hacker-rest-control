# Hacker REST Control

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=lamnguyenx.vscode-hacker-rest-control">
    <img alt="REST Control" src="./assets/logo.drawio.png" height="200">
  </a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=lamnguyenx.vscode-hacker-rest-control" title="Check it out on the Visual Studio Marketplace">
    <img src="https://vscode-marketplace-badge.vercel.app/api/badge/version/lamnguyenx.vscode-hacker-rest-control" alt="Visual Studio Marketplace" style="display: inline-block" />
  </a>

  <img src="https://vscode-marketplace-badge.vercel.app/api/badge/installs/lamnguyenx.vscode-hacker-rest-control" alt="Number of installs"  style="display: inline-block;margin-left:10px" />

  <a href="https://www.buymeacoffee.com/dpar39" title="Buy me a coffee" style="margin-left:10px">
    <img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-$3-blue?logo=buy-me-a-coffee&style=flat" alt="Buy me a coffee" style="display: inline-block" />
  </a>
</p>

This extension allows you to remotely control instances of Visual Studio Code by exposing a REST endpoint that you can use to invoke vscode commands. In the background it launches a HTTP server that listen on the `localhost` interface for requests of commands to execute.

The demo below shows how we can open a terminal, run some commands in it, then close all terminals, open a file with the cursor in a specified location and finally start a debug session on the same file that is orchestrating it all!

![sample automation demo](assets/automation-demo.gif)

**DISCLAIMER: This extension was forked from [Remote Control](https://github.com/estruyf/vscode-remote-control).**
The main motivation behind it was that while `Remote Control` uses `websockets`, for my use case I can only rely on HTTP REST calls. In addition, some commands I need to use require non-primitive JavaScript types which are not handled except for a couple of cases in the original extension (e.g. the `Uri` for `vscode.open` command).

## Quick start

Install the extension, then send a command to the port it reports (the example
assumes `37100`):

```bash
curl http://localhost:37100 -d '{"command":"workbench.action.terminal.new"}'
```

Pin the port in containers and automated environments with
`HACKER_REST_CONTROL_PORT`; it overrides the `restRemoteControl.port` setting.

## Docs

### [Usage](docs/important/usage/)

- [Settings](docs/important/usage/settings.md): enable/disable, the port, and fallback ports.
- [HTTP API](docs/important/usage/http-api.md): how the server starts, the request body and query forms, and the special `__type__` arguments.
- [Custom commands](docs/important/usage/custom-commands.md): the `custom.*` commands that need the VS Code API, plus the planned breakpoint command.
- [How do I get the command ID?](docs/important/usage/command-ids.md): find a built-in or extension command ID from the Command Palette.

### [Testing](docs/important/testing/)

- [How to test REST Control](docs/important/testing/how-to-test.md): the committed Playwright suite, the HTTP contract oracles, and the known manual limits.

## Feedback / issues / ideas

Please submit your feedback/issues/ideas by creating an issue in the project repository: [issue list](https://github.com/lamnguyenx/vscode-hacker-rest-control/issues).
