# Custom commands

The special commands that need the VS Code API, plus the planned breakpoint command.

As the extension progresses, I plan to add more _special_ commands (i.e. commands that require some use of the [VSCode API](https://code.visualstudio.com/api/references/vscode-api)). For now, we have defined the following commands:

- `custom.goToFileLineCharacter`: allows you to navigate to a specific position in a file by passing the file path, line and column number as arguments
- `custom.startDebugSession`: allows you to invoke `vscode.debug.startDebugging()` API by passing the workspace folder and a name or definition of a debug configuration as it would be set in `launch.json`
- `custom.runInTerminal`: allows you to invoke commands the currently active integrated terminal
- `custom.showQuickPick`: show quick pick dialog to collect selection from the user
- `custom.showInputBox`: show input box dialog to collect a input string from the user
- `custom.showInformationMessage`, `custom.showWarningMessage` and `custom.showErrorMessage`: show message dialogs to the user and let them click on a button
- `custom.listInstalledExtensions`: get the list of installed extension IDs
- `custom.getExtensionInfo`: get details of an installed extension by passing the extension ID
- `custom.registerExternalFormatter`: registers an external formatter via a HTTP endpoint. The HTTP endpoint will receive a JSON body with the following properties`{"file": "<document file path>", "snippet": "<content to be formatted>", "language": "<language id of the current file>"}` and it should return in the body the formatted code snippet (or the original if the code can't be formatted).
- `custom.listOpenedFiles`: gets the list of all files currently opened (`string[]`)
- `custom.currentFileContent`: to get the content of the current (in-focus) editor as a string (`string` or `null`)
- `custom.registerEventHandler`: so that an external HTTP server can handle events from VSCode API. Events supported right now are:
  - `vscode.window.onDidChangeActiveTextEditor`
  - `vscode.window.onDidChangeTextEditorSelection`
  - `vscode.workspace.onDidSaveTextDocument`
  - `vscode.workspace.onDidOpenTextDocument`
  - `vscode.workspace.onDidCloseTextDocument`

## To implement in the near future:
- Add the ability to set a breakpoint at the specified file/line combination
