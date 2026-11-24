# Third-party references

The local microphone recording and post-recording upload workflow references
[faceair/TingwuMeetingAgent](https://github.com/faceair/TingwuMeetingAgent),
licensed under Apache License 2.0. The request shapes in `desktop/local-uploads.mjs`
follow its `TingwuAPI.swift` and `TingwuUploader.swift`. The recording helper, local
IPC, queue persistence, UI and scheduler integration are implemented here.
This implementation retains local audio after successful upload.

The upstream license is included in `LICENSES/TingwuMeetingAgent-Apache-2.0.txt`.

Uploads use [ali-sdk/ali-oss](https://github.com/ali-sdk/ali-oss), the Alibaba Cloud
OSS JavaScript SDK (MIT), pinned in `package-lock.json`. Its license is distributed
with the installed dependency.

## parse5 / entities

笔记同步使用 parse5 7.3.0（MIT）解析旧版 Lake HTML，及其 entities 依赖（BSD-2-Clause）。上游：https://github.com/inikulin/parse5 。随安装的 npm 包保留各自 LICENSE 文件。
