NAME    := $(shell node -p "require('./package.json').name")
VERSION := $(shell node -p "require('./package.json').version")
PUB     := $(shell node -p "require('./package.json').publisher")
EXT_ID  := $(PUB).$(NAME)-$(VERSION)
VSIX    := build/$(EXT_ID).vsix

.PHONY: build install install-code install-code-server vsix typecheck-tests test-e2e

build: vsix

install: install-code install-code-server

install-code: build
	code --install-extension $(VSIX) --force

install-code-server: build
	code-server --install-extension $(VSIX) --force

vsix:
	mkdir -p build
	npx --yes @vscode/vsce pack -o $(VSIX)

## Strict typecheck of the committed E2E suite.
typecheck-tests:
	npx tsc -p tsconfig.tests.json

## Playwright E2E (REST Control arranges/acts; CDP browser asserts).
## Requires code-server + the CDP browser + REST Control to be running.
## See docs/important/how-to-test.md.
test-e2e:
	CDP_PORT=$(CDP_PORT) npx playwright test --config playwright.config.ts