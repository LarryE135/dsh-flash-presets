# Security Policy

## Supported versions

The latest published dsh-flash-presets line on npm and main on GitHub receive fixes.
Older minors get fixes only when the issue is trivially backportable.

## Reporting a vulnerability

Please do not open a public issue for security reports. Use GitHub private vulnerability
reporting at <https://github.com/LarryE135/dsh-flash-presets/security/advisories/new>.
Expect an acknowledgement within 7 days, and a fix or a documented mitigation within 30 days.

## What this package can and cannot do

Installing dsh-flash-presets adds @deepseek-ai/dsh-agent-preset rows to the target DSH profile
through a Cordis bundle patch (cordis.patch.yml) plus preset YAML. It does not patch host source
at runtime, does not open network connections, does not read credentials or session data, and
does not spawn processes. Uninstalling restores the profile's previous dependency, bundle and
patch layers.

Vulnerabilities in DeepSeek Harness itself or in @deepseek-ai/dsh-agent-preset should be
reported to their maintainers.
