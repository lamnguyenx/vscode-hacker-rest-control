NAME    := $(shell node -p "require('./package.json').name")
VERSION := $(shell node -p "require('./package.json').version")
PUB     := $(shell node -p "require('./package.json').publisher")
EXT_ID  := $(PUB).$(NAME)-$(VERSION)
VSIX    := build/$(EXT_ID).vsix

# Inputs that decide whether the VSIX is stale: `$(VSIX)` depends on these,
# so make skips `vsce pack` while the VSIX is newer than all of them (same
# mtime rule as the meta repo's `make install-ssh`). Generated trees (out/,
# build/, node_modules/) are deliberately absent — the recipe rebuilds them.
SOURCES := $(shell find src assets -type f 2>/dev/null) \
	package.json package-lock.json tsconfig.json webpack.config.js

.PHONY: build install install-code install-code-server vsix typecheck-tests test-e2e

build vsix: $(VSIX)

install: install-code install-code-server

install-code: build
	code --install-extension $(VSIX) --force

install-code-server: build
	code-server --install-extension $(VSIX) --force

$(VSIX): $(SOURCES)
	mkdir -p build
	npx --yes @vscode/vsce pack -o $@

## Strict typecheck of the committed E2E suite.
typecheck-tests:
	npx tsc -p tsconfig.tests.json

## Playwright E2E (REST Control arranges/acts; CDP browser asserts).
## Requires code-server + the CDP browser + REST Control to be running.
## See docs/important/testing/how-to-test.md.
test-e2e:
	CDP_PORT=$(CDP_PORT) npx playwright test --config playwright.config.ts