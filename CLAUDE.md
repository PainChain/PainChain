I## Keep dependencies current

* Always run dependency updates before pushing.
* Verify compatibility and test locally after updates (npm run dev, pytest, etc.).
* Avoid introducing breaking changes from untested package upgrades.

## Prioritize security

* Sanitize all user inputs and validate API requests.
* Never log or expose sensitive data (keys, tokens, credentials).
* Use least-privilege access for services and environment variables.
* Review third-party packages for known vulnerabilities before adding.

## Preserve existing functionality

* Do not merge or push code that breaks existing features.
* Run regression tests or QA flows before committing.
* If you must refactor or remove functionality, replace or fix it in the same PR.

## Document new features

* Add every new feature to features.json with a clear description and version tag.
* Keep naming consistent and use lowercase keys with underscores.

## Follow clean commit and PR standards

* Use descriptive commit messages (e.g., feat(auth): add JWT validation).
* Reference related issues or tasks.
* Keep PRs focused — one logical change per branch.

## Test before you push

* Run all tests and linters (npm test, pytest, pre-commit, etc.).
* Ensure both new and existing functionality behave as expected.

## Follow existing code patterns where possible