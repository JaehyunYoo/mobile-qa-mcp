# flutter-mobile-qa-mcp

[English](README.md) | [한국어](README.ko.md) | **日本語**

**AIエージェント（Claude Codeなど）が実機やシミュレーター上のモバイルアプリを直接操作してQAを行う**ためのMCPサーバーです。
**自社アプリにも他社アプリにも**利用でき、ソースコードがなくても使えます。[他社アプリのQA](#4-6-他社アプリのqaブラックボックス)を参照してください。
**Flutter向けに最適化**されていますが、内部のmobile-mcpを通じて、ほとんどの機能を**ネイティブiOS・Androidアプリにも利用できます**。[アプリ種別ごとの対応](#1-1-アプリ種別ごとの対応)を参照してください。

内部で次の2つのMCPサーバーを起動し、連携させます。

| 内部サーバー | アプリの見方 | 得意なこと |
|---|---|---|
| [mobile-mcp](https://github.com/mobile-next/mobile-mcp) | **アプリの外側**：OSのアクセシビリティツリーとスクリーンショット | 画面テキストの取得、タップ、スワイプ、iOSの権限ダイアログ・通知バナー・Webログインなどの**アプリ外の画面** |
| Dart MCP（`dart mcp-server`） | **アプリの内側**：実行中アプリのVMサービス。**Flutter専用** | **文字入力**、ウィジェットツリー、Flutterの実行時エラー、ウィジェット指定のタップ |

両者の機能を補完し、**複数の操作を1つのツールにまとめ、応答を要約**することで、呼び出し回数とトークン使用量を減らします。

```text
AIエージェント ── flutter-mobile-qa-mcp ─┬─ mobile-mcp      ── 端末（アクセシビリティ・画像・タップ）
                                       └─ dart mcp-server ── アプリ（flutter_driver・ウィジェット・エラー）
```

> ステータス：0.5.0。内部サーバーの動作は実機（iPhone、iOS 26）とシミュレーターで確認済みです。
> 0.5.0の新機能（環境診断・条件待機・ref/idによる選択・実行記録）はオフラインの単体確認のみで、**実機での検証はまだです**。
>
> デフォルトのREADMEは英語です。スキル、サーバー指示、ワークフロープロンプト、ツール説明、シナリオガイドは英語で管理しています。エージェントの説明・シナリオ・レポートはユーザーが指定した言語に従います。一部の実行時メッセージは韓国語です。韓国語UIを対象とする例では元のラベルを保持しています。選択子には実際の画面の文字列を使ってください。

---

## クイックスタート

**`qa_*`ツールを自分で直接呼び出す必要はありません。** エージェントに自然言語で依頼すると、必要なツールを選択します。
端末を操作する前に、エージェントが予定している操作を説明し、確認を求めるワークフローです。

### 1）自然言語で依頼する

| 目的 | 依頼例 |
|---|---|
| シナリオ作成 | 「ToDo編集機能のQAシナリオを作って」 |
| シナリオ実行 | 「qa/scenarios/todo-002.mdを実行して」 |
| 探索して問題を探す | 「マイタブを見て、表示がおかしいテキストがないか確認して。値は変更しないで」 |
| 結果の整理 | 「リリース判断用にQA結果をまとめて」 |
| 環境の確認 | 「QA環境を診断して」→ `qa_doctor` |
| 他社アプリ | 「InstagramのアプリIDを調べて起動し、ログイン画面を確認して。タップや入力はしないで」→ `qa_apps` → `qa_launch` → 確認 |
| 終了 | 「QAが終わったので片付けて」→ `qa_finish`（端末の「Automation Running」表示を解除） |

### 2）`/`コマンドで手順に沿って進める

Claude Codeの入力欄で`/`を入力し、`flutter-mobile-qa`を探すと4つのプロンプトが表示されます。選択して引数を指定します。

| コマンド | 引数（**太字**は必須） | 例 |
|---|---|---|
| `/mcp__flutter-mobile-qa__plan_qa` | **feature**, depth(smoke/standard/deep), source | `ToDo編集`, `standard` |
| `/mcp__flutter-mobile-qa__run_qa` | **scenario**, logFile, allowDanger(yes), reportLanguage(en/ko/ja) | `qa/scenarios/todo-002.md`, `/tmp/qa_run.log` |
| `/mcp__flutter-mobile-qa__explore_qa` | **area**, focus, logFile, reportLanguage(en/ko/ja) | `マイタブ全体`, `テキストの表示崩れ` |
| `/mcp__flutter-mobile-qa__report_qa` | **scenarios**, audience, reportLanguage(en/ko/ja) | `qa/scenarios`, `リリース判断` |

> `/`一覧に表示されるのはプロンプトのみです。18個のツールは`/mcp` → `flutter-mobile-qa` → **View tools**で確認できます。
> 更新後に新しいツールが表示されない場合は、`/reload-plugins`または`/mcp`の**Reconnect**を使ってください。

### 3）最初に環境を診断する

「QA環境を診断して」と依頼すると、`qa_doctor`が端末、操作エージェント、Dart接続を確認し、**現在使える機能と復旧方法**を表で返します。ツールが予想外に失敗した場合も、アプリのバグと環境の問題を切り分けるため、まず診断してください。

### 4）文字入力を伴うFlutterのQAでは、先にアプリを起動する

```bash
flutter run -t lib/entry/entry_dev_driver.dart -d <device> --print-dtd > /tmp/qa_run.log 2>&1
```

このパスを`run_qa`の`logFile`に渡すか、「アプリは起動済みで、ログは/tmp/qa_run.log」と伝えます。詳しくは[準備](#2-準備)を参照してください。

---

## 目次

1. [できることと制約](#1-できることと制約)
2. [準備](#2-準備)
3. [インストールと登録](#3-インストールと登録)
4. [使い方](#4-使い方) — **初めてなら4-0から**
5. [ツールリファレンス](#5-ツールリファレンス) — 選択子・待機・実行記録・診断
6. [安全機能とプロジェクト設定](#6-安全機能とプロジェクト設定)
7. [トラブルシューティング](#7-トラブルシューティング)
8. [QAしやすいアプリにする方法](#8-qaしやすいアプリにする方法)

---

## 1. できることと制約

以下は実機QAで確認した内容です。

### 対応している操作

| 操作 | ツール・方法 | 補足 |
|---|---|---|
| 画面テキスト、ボタン、入力欄の値を読む | `qa_read_screen` | Flutterの`Text`、Materialボタン、入力欄を名前で取得 |
| テキストボタン、メニュー、下部タブを押す | `qa_tap` | 閉じる、利用規約、Googleで開始、ホーム、カレンダーなど |
| iOSの権限ダイアログを処理する | `qa_dismiss_system` / `qa_tap` | 通知、ローカルネットワーク、トラッキング |
| 文字を入力する | `qa_type` | mobileでフォーカス → Dartで入力 → 値を確認 |
| 有効・無効状態、テキストの有無を検証する | `qa_expect` | タイトル入力後に保存ボタンが有効になるか、など |
| スクロール、引っ張って更新 | `qa_swipe` | |
| アプリの起動・再起動 | `qa_launch` | |
| QA終了後の片付け | `qa_finish` | iOSの「Automation Running」を解除 |
| 実行時エラー・クラッシュの確認 | `qa_errors` | |
| プッシュ通知タップ・ディープリンクの遷移確認（シミュレーター） | シェルの`xcrun simctl push` / `simctl openurl`で送信後、このサーバーで検証 | [4-4](#4-4-プッシュ通知とディープリンクシミュレーター)を参照 |

実際の検出例：`qa_read_screen`によるテキスト比較で、予定の時刻が9時間ずれて表示されるバグを発見しました。

### 条件付きで対応

| 操作 | 条件・制約 |
|---|---|
| **アイコンのみのボタン**（戻る、閉じる、設定、編集、削除） | アクセシビリティ名がなければ`qa_tap_xy`で座標指定。`tooltip`/`Semantics`を付ければ`qa_tap`が使えます。[8章](#8-qaしやすいアプリにする方法)を参照 |
| **WebView内部**（OAuthログイン、アプリ内Web） | 要素を取得できない場合は`qa_screenshot`で確認して`qa_tap_xy` |
| Flutterの文字入力 | 検証した実機iOSの経路では、Dart接続（`qa_connect`）とflutter_driver用エントリーポイントが必要 |

### 未対応または人が行う操作

- パスワード・認証コードの入力、Face ID、個人アカウントの選択
- 決済の確定、ストアへのログイン
- ホーム画面ウィジェットの実際の表示確認、実サーバーからのプッシュ通知の受信確認（シミュレーターの`simctl push`ではタップ後の遷移を確認可能）
- 画面録画（実機iOSでファイルが保存されませんでした）

### 1-1. アプリ種別ごとの対応

上記はFlutterを中心とした確認結果です。各ツールが使う内部サーバーによって対応範囲が異なります。
Dart接続（`qa_connect`の`logFile`）はFlutter専用です。**ネイティブアプリはDartなしで端末接続のみ**を使います。

| ツール | 内部サーバー | Flutter | ネイティブiOS（UIKit / SwiftUI） | ネイティブAndroid（View / Compose） |
|---|---|---|---|---|
| `qa_read_screen` | mobile | ✅ `Text`・Materialウィジェット | ✅ 標準コントロールのアクセシビリティを取得しやすい | ✅ `contentDescription` / テキスト |
| `qa_tap` | mobile → FlutterではDartにフォールバック | ✅ テキストボタン。名前のないアイコンは座標 | ✅ `accessibilityLabel`。ラベルのない画像ボタンは座標 | ✅ `contentDescription` |
| `qa_type` | Dart接続時はDart / それ以外は端末キーボード | ✅ **検証した実機iOSではDartが必要**（Flutter入力欄でキーボードが表示されないため） | ✅ 端末キーボード | ✅ 端末キーボード |
| `qa_expect` · `qa_swipe` · `qa_tap_xy` · `qa_screenshot` | mobile | ✅ | ✅ | ✅ |
| `qa_dismiss_system` · `qa_launch` · `qa_apps` · `qa_finish` | mobile | ✅ | ✅ | ✅ ダイアログ規則の既定値は韓・英・日のiOS文言。設定で追加可能 |
| `qa_wait_until` · `qa_run_start` / `qa_step` / `qa_run_end` · `qa_doctor` | mobile（+ Dart） | ✅ | ✅ | ✅ |
| `id`選択子（アクセシビリティ識別子） | mobile | ✅ `Semantics(identifier:)`（Flutter 3.19+） | ✅ `accessibilityIdentifier` | ✅ `resource-id` |
| `key`選択子（ValueKey） | Dart | ✅ | ❌ | ❌ |
| `qa_errors` | Dart + mobile | ✅ 実行時エラー + クラッシュ | ⚠️ クラッシュ一覧のみ | ⚠️ クラッシュ一覧のみ |
| `qa_connect` | mobile（+ Dart） | 端末 + Dart | 端末のみ（`logFile`省略） | 端末のみ |
| ウィジェットツリー・Flutterウィジェット指定のタップ | Dart | ✅ | ❌ | ❌ |

ネイティブiOSの**設定アプリ**では、起動、要素一覧、タップ、スワイプ、ホームボタンの動作を確認済みです。ネイティブアプリの文字入力は端末キーボード経由で実装していますが、実機での検証はまだです。

**その他のフレームワーク**

| 種類 | 対応 | 補足 |
|---|---|---|
| React Native | ✅ ネイティブと同じmobile経由 | `accessibilityLabel`/`testID`を設定すると名前で対象を選択可能 |
| WebView・ハイブリッド（Capacitorなど） | ⚠️ Web内部の要素を取得しにくい | スクリーンショット + 座標。Web部分はPlaywrightなどのWebツールが適しています |
| ゲームエンジン（Unityなど）・Canvas描画 | ⚠️ アクセシビリティツリーがほぼない | スクリーンショット + 座標のみ |

**ネイティブアプリでの流れ**

```text
qa_connect()                      # logFileなし：端末のみ接続
qa_launch(packageName: "com.example.app")
qa_dismiss_system()
qa_read_screen() → qa_tap(text: "…") → qa_type(field: "メールアドレス", text: "…") → qa_expect(…)
qa_finish()
```

ワークフロープロンプト（`plan_qa`、`run_qa`、`explore_qa`、`report_qa`）も利用できます。`run_qa`では`logFile`を省略します。

### 注意点

- **一度だけ表示されるオーバーレイ**（初回ガイド、イベントポップアップ）が流れを遮ることがあります。座標を記憶して押すのではなく、**画面を読んで判断してから操作する**シナリオにしてください。
- スワイプがタップと認識され、別のカードを開く場合があります。引っ張って更新する際は`fromY`を画面上部のヘッダー付近に指定します。
- ダイアログ規則と危険語の既定値は**韓国語・英語・日本語**です。他の言語やアプリ固有の文言は[設定ファイル](#プロジェクト設定ファイル任意)で追加できます。

---

## 2. 準備

### 共通

- Node.js 20+
- FlutterアプリではFlutter SDK。**fvmは任意**です。プロジェクトに`.fvmrc`または`.fvm/fvm_config.json`があれば`fvm dart`、なければPATH上の`dart`を使います。`QA_PROJECT_DIR`でプロジェクトルートを指定します。

### iOSシミュレーター

- Xcodeコマンドラインツールと、起動済みのシミュレーター（`xcrun simctl boot <udid>`）。

### iOS実機

1. USB接続、ロック解除、「このコンピュータを信頼」、デベロッパモードの有効化。
2. **操作エージェントをインストール**します。初回のみ必要で、プロファイル失効時は再インストールします。

   ```bash
   # mobile-mcpが取得したmobilecli
   MOBILECLI=$(ls ~/.npm/_npx/*/node_modules/@mobilenext/mobilecli-darwin-arm64/mobilecli-darwin-arm64 | head -1)
   $MOBILECLI agent install --device <device-UDID> \
     --provisioning-profile "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/<wildcard-development-profile>.mobileprovision"
   ```

   プロファイルには**ワイルドカードApp ID（`TEAMID.*`）**、開発用の`get-task-allow`、対象端末のUDIDが必要です。有効期限内であることも確認してください。`security cms -D -i <file>`で開き、`application-identifier`と`ProvisionedDevices`を確認できます。
   端末のホーム画面にエージェントアプリが追加されます。操作中は時計が赤く表示される場合があります。

### Android

- `adb`（Android platform-tools）：`brew install --cask android-platform-tools`。
- エミュレーター、またはUSBデバッグを有効にした端末。

### Flutterアプリの準備：文字入力・ウィジェット指定のタップ

> ネイティブアプリはこの節を省略できます。端末にデバッグ/QAビルドをインストールしてください。

flutter_driver拡張を有効にする**QA専用のエントリーポイント**を用意します。ストア向けビルドには使いません。

```yaml
# pubspec.yaml
dev_dependencies:
  flutter_driver:
    sdk: flutter
```

```dart
// lib/entry/entry_dev_driver.dart
import 'package:flutter_driver/driver_extension.dart';
import 'entry_dev.dart' as dev;

Future<void> main() async {
  enableFlutterDriverExtension();
  await dev.main();
}
```

**DTDアドレスを出力**するように起動します。

```bash
flutter run -t lib/entry/entry_dev_driver.dart -d <device> --print-dtd > /tmp/qa_run.log 2>&1
# 次のログが出れば準備完了：
# The Dart Tooling Daemon is available at: ws://127.0.0.1:…
```

---

## 3. インストールと登録

```bash
git clone <repository-url> ~/Desktop/flutter-mobile-qa-mcp   # またはコピー
cd ~/Desktop/flutter-mobile-qa-mcp
npm install && npm run build
```

QA対象アプリのプロジェクトルートでClaude Codeに登録します。

```bash
claude mcp add flutter-mobile-qa --scope project \
  -e QA_PROJECT_DIR="$PWD" \
  -e QA_DEVICE=<device-UDID> \
  -- node ~/Desktop/flutter-mobile-qa-mcp/dist/index.js
```

`-e QA_DEVICE=…`を省略すると最初の端末を使います。登録後は**Claude Codeを再起動**してください。

| 環境変数 | 既定値 | 説明 |
|---|---|---|
| `QA_DEVICE` | 最初の端末 | mobile-mcpの端末ID |
| `QA_PROJECT_DIR` | 現在のフォルダー | Dart MCPの作業ディレクトリ、fvm判定、設定ファイル（`qa/qa.config.json`）、実行記録の基準となるプロジェクトルート |
| `QA_DART_CMD` | fvm設定あり：`fvm dart mcp-server`、なし：`dart mcp-server` | 別構成の場合に指定。例：`/opt/flutter/bin/dart mcp-server`、`puro dart mcp-server` |
| `QA_CONFIG` | `<project>/qa/qa.config.json` | プロジェクト設定のパス |
| `QA_RUNS_DIR` | `<project>/qa/runs` | 実行記録フォルダー |
| `QA_MOBILE_MCP` | `@mobilenext/mobile-mcp@1.0.5` | 固定バージョン。ツール名が変わった場合はこのサーバーも更新が必要 |

> mobile-mcpとDart MCPを別々に登録する必要はありません。このサーバーが内部で起動します。

---

## 4. 使い方

### 4-0. 組み込みのQAワークフロー

**何を、どの順序でテストするか**を決めるためのワークフローが組み込まれています。

| 段階 | 使用するもの | 内容 | 端末操作 |
|---|---|---|---|
| ① 計画 | `plan_qa` | 機能説明、関連コード、画面文言から、基本フロー・境界値・状態反映・取消・権限・回帰の**シナリオセット**を`qa/scenarios/*.md`に作成 | ソース参照時はなし。ブラックボックス調査では確認後に操作 |
| ② レビュー | 人 | シナリオファイルのMarkdown表を確認・修正 | なし |
| ③ 実行 | `run_qa` | 操作内容の確認後、各段階を操作 → `qa_expect`で判定 → PASS/FAILを記録 → 作成データを片付け | あり |
| ④ 報告 | `report_qa` | リリース可否、ブロッカー、再現手順、次の対応を整理 | なし |
| 随時：探索 | `explore_qa` | シナリオなしで画面を巡回し、表示崩れ・空画面・エラーを探す。データは変更しない | あり |

Claude Codeでは`/mcp__flutter-mobile-qa__plan_qa`などの`/`コマンドとして表示されます。「ToDo作成のQAシナリオを作って」と自然言語でも依頼できます。

**同梱のガイド**

- **サーバー指示**：接続時にエージェントへ渡す原則。読む → 判断 → 操作 → 検証、テキスト優先、データの片付け、危険操作・認証の人への引き継ぎ、操作前の確認。
- **シナリオ形式**：[guides/SCENARIO_FORMAT.md](guides/SCENARIO_FORMAT.md)。リソースは`qa://guides/scenario-format`。
- **シナリオ例**：[guides/example-schedule-create.md](guides/example-schedule-create.md)。
- **任意のClaude Codeスキル**：[skills/flutter-mobile-qa/SKILL.md](skills/flutter-mobile-qa/SKILL.md)。自然言語の依頼をワークフローへ振り分けます。インストール：`cp -r skills/flutter-mobile-qa ~/.claude/skills/`。

**利用例**

```text
ユーザー：ToDo機能のQAシナリオをstandardで作って。
→ qa/scenarios/todo-001〜005.mdを作成し、一覧表を提示。
ユーザー：（レビュー後）todo-001と002を実行して。ログは/tmp/qa_run.log。
→ 操作内容を要約して確認 → 実行 → ファイル末尾に結果を追加。
ユーザー：リリース判断用に結果をまとめて。
→ レポートを作成。
```

### 4-1. ツールを直接使う基本フロー

```text
qa_doctor(logFile: "/tmp/qa_run.log")      # 環境診断。ネイティブ・他社アプリはlogFileを省略
qa_connect(logFile: "/tmp/qa_run.log")     # 端末 + FlutterのDart接続
qa_run_start(name: "TODO-002")            # 実行記録を開始（任意）
qa_dismiss_system()                      # 権限ダイアログ・ポップアップを処理
qa_read_screen()                         # 現在の画面 → r1, r2, …
qa_tap(ref: "r12", waitFor: {text: "…", state: "present"})
qa_type(field: "…", text: "…")
qa_expect(text: "…", state: "enabled", timeoutMs: 5000)
qa_step(title: "…", expected: "…", result: "pass")
qa_run_end()                             # report.mdを生成
qa_finish()                              # 端末エージェントを終了
```

操作ツールは**操作後の画面要約**も返します。新しいrefが含まれていれば、その結果を利用して`qa_read_screen`の重複呼び出しを減らせます。

### 4-2. エージェントへの依頼例

```text
flutter-mobile-qaでホーム → マイ → 利用規約へ移動して戻り、
各画面のテキスト表示やエラーを確認して。
```

```text
タイトル「QA 테스트」の予定を1つ作って。保存後のホームカードに、
編集画面と同じタイトル・時刻が表示されることを確認し、最後に削除して（削除許可）。
```

```text
設定画面の各トグルについて、ラベルとオン/オフ状態だけを表にまとめて。値は変更しないで。
```

### 4-3. 例：予定作成シナリオ

以下は韓国語UIを対象とする例です。実際の画面と一致するよう、選択子は韓国語のままにします。

```text
qa_read_screen(filter: "일정")
  → "r18 일정을 공유해보세요 @214,661"
qa_tap(ref: "r18", waitFor: {text: "일정을 생성할게요"})
  → 待機PASS（620ms）+ 作成画面の要約
qa_expect(text: "일정을 생성할게요", state: "disabled")
  → PASS（タイトルは空）
qa_type(field: "제목을 입력해주세요", text: "QA 테스트")
  → 入力完了・値を確認
qa_expect(text: "일정을 생성할게요", state: "enabled", timeoutMs: 3000)
  → PASS
qa_tap(text: "일정을 생성할게요", waitFor: {text: "QA 테스트"})
  → ホームの要約に「나 / QA 테스트 / 오후 12:00 ~ 오후 1:00」
```

同じ文言のボタンが複数ある場合、`qa_tap`がrefと位置を含む候補を返します。対象の`ref`で再指定してください。

### 4-4. プッシュ通知とディープリンク（シミュレーター）

このサーバーは送信を行いません。シェルで送信・起動した後に結果を検証します。

```bash
# プッシュ通知：FCMのタップイベントにはpayload内のgcm.message_idが必要
cat > push.apns <<'JSON'
{"aps":{"alert":{"title":"t","body":"b"}},"gcm.message_id":"1","messageType":"VIEW_CALENDAR"}
JSON
xcrun simctl push <udid> <bundle-ID> push.apns
# ディープリンク：iOSの確認ダイアログが出たらqa_tapで「開く」を押す
xcrun simctl openurl <udid> 'myscheme://open?…'
```

### 4-5. トークン使用量を抑える

- 画面の確認は`qa_screenshot`（画像）より`qa_read_screen`（テキスト）を優先し、`filter`で対象を絞ります。
- 判定は`qa_expect`の1行PASS/FAILを使います。
- 画像はレイアウトや色など、**視覚的な確認が必要な場合**に使います。

### 4-6. 他社アプリのQA（ブラックボックス）

ソースがないアプリも端末接続だけでQAできます。Flutter製でもDartに接続できなければ、ネイティブと同じ経路を使います。

1. `qa_apps(filter: "アプリ名")`でバンドルIDを確認し、`qa_launch(packageName)`で起動します。
2. ソースがなければ、`plan_qa`は**ブラックボックス調査**を行います。端末操作の確認を得た後、データを変えずに画面を巡回し、実際の文言とフローを集めてシナリオを作成します。
3. `run_qa`と`explore_qa`は通常どおり使えます。シナリオと実行記録は現在の作業フォルダーの`qa/`以下に保存します。

注意点：

- 決済・投稿・メッセージ送信・フォローなどは**実際のサービスに影響**します。探索は保存や送信を伴わない画面移動の範囲にし、アプリ固有の危険語を`qa/qa.config.json`に追加してください。
- テストアカウントを使い、利用規約が認める範囲で行ってください。
- 他社のFlutterアプリでは、実機iOSでキーボードが表示されず、Dartにも接続できないため、文字入力できない場合があります。シミュレーター・Androidでは通常、端末キーボードを使います。

---

## 5. ツールリファレンス

### 選択子

`qa_tap`、`qa_type`、`qa_expect`で各ツールが対応する選択子を使います。`qa_type`のテキスト選択子は`field`です。

| 選択子 | 例 | 説明 |
|---|---|---|
| `ref` | `r12` | 直前の画面取得・操作後の要約に含まれる参照。使用前にラベルと位置を再確認し、対象が変化していれば拒否 |
| `id` | `todo_title` | アクセシビリティ識別子。**文言や言語が変わっても安定**。[8章](#8-qaしやすいアプリにする方法)を参照 |
| `text` | `저장` | 表示テキスト。完全一致 → 部分一致の順で検索。`exact: true`なら完全一致のみ |
| `index` | `1` | 複数候補のうち、0から数えた位置 |
| `key`（`qa_tap`のみ） | `save_button` | Flutterの`ValueKey<String>`。Dart接続が必要 |

候補が複数あると、**タップせずに候補一覧**（refと位置）を返します。同じ「削除」ボタンが複数ある画面で、別の対象を押すのを防ぎます。

### 待機

- 操作ツール（`qa_tap`、`qa_tap_xy`、`qa_swipe`、`qa_launch`）に`waitFor: {text|id, state}`と`timeoutMs`を渡すと、**条件成立まで待機**します。省略時は**画面が安定するまで**待ちます（連続2回同じ画面、通常最大3秒。起動時は別のタイムアウト）。
- `qa_expect(..., timeoutMs)`は条件成立またはタイムアウトまで再確認します。`qa_wait_until`はローディング消失（`absent`）、ボタン有効化（`enabled`）、画面安定（`stable: true`）に使えます。

### 検証と失敗時の復旧

- `qa_expect(state: "absent")`は、有効な選択子に一致する要素がない場合のみ成功します。`STALE_REF`と`INVALID_SELECTOR`は失敗です。削除・画面遷移後の不在確認には安定した`id`か完全一致の`text`を使います。`present`・`absent`は複数一致の有無を確認できますが、`enabled`・`disabled`は一意の対象または明示的な`index`が必要です。
- `qa_type`は**入力対象のフィールド自体の値が完全一致するか**を検証します。画面上の別の要素に同じ文字列があっても成功しません。キーボード表示でフィールドが移動しても追跡できるよう`id`を推奨します。IDがない場合はラベル・種類・近い位置で同じフィールドを一意に特定する必要があります。非公開・マスク済み・取得不能の値は自動検証できません。`timeoutMs`は入力後の検証待機時間（既定3000ms）で、入力の再実行は行いません。
- 安定待機は連続2回同じアクセシビリティ画面を確認した場合のみ成功します。時間内に安定しなければ`WAIT_TIMEOUT`エラーと最後の画面要約を返します。待機失敗は直前のタップや起動の失敗を意味しません。アニメーション画面では具体的な`waitFor`条件を推奨します。
- スキルと実行プロンプトは**失敗したステップにつき修正後の再試行を1回まで**に制限します。現在の状態を確認し、元の失敗を記録します。復旧できなければ依存するステップをスキップします。保存・送信・作成・削除・決済の結果が不明な場合は操作を繰り返しません。接続問題は`qa_doctor`で一度診断し、必要な機能の復旧後に再開します。

### ツール

| ツール | 引数 | 動作 |
|---|---|---|
| `qa_doctor` | `logFile?`, `dtdUri?` | Node、mobile-mcp、端末、エージェント、画面取得、識別子、Dart、flutter runログ、DTD、flutter_driverを診断。利用可能な機能と復旧方法を表示 |
| `qa_connect` | `logFile?`, `dtdUri?`, `device?` | 端末を選択。FlutterではDTDに接続し`set_frame_sync false`。ネイティブ・他社アプリでは`logFile`省略 |
| `qa_apps` | `filter?` | インストール済みアプリの名前・バンドルIDを検索 |
| `qa_launch` | `packageName`, `restart?`, `waitFor?`, `timeoutMs?` | 起動・再起動 → 安定または条件待機 → 画面要約 |
| `qa_read_screen` | `filter?`, `limit?`(60) | `ref [種類]テキスト = 値 id=識別子 (無効) @x,y`形式の要約 |
| `qa_tap` | 選択子, `key?`, `allowDanger?`, `waitFor?`, `timeoutMs?` | 要素をタップ。見つからなければFlutterのテキスト・ツールチップへフォールバック。危険語を確認し、待機後に画面要約 |
| `qa_tap_xy` | `x`, `y`, `waitFor?`, `timeoutMs?` | 名前・IDのない対象を座標でタップ。危険語の制限は適用されない |
| `qa_type` | `field?`/`id?`/`ref?`, `index?`, `text`, `timeoutMs?`(3000) | 入力欄をタップ → Dartの`enter_text`または端末キーボードで入力 → 値を確認 |
| `qa_expect` | 選択子, `state?`, `timeoutMs?` | 1行のPASS/FAIL。記録中のFAILでは証拠を自動保存 |
| `qa_wait_until` | `text?`/`id?`, `state?`, `stable?`, `timeoutMs?`(10000) | 条件成立・画面安定を待機 |
| `qa_dismiss_system` | なし | 既定の韓・英・日規則とプロジェクト規則でダイアログを処理 |
| `qa_swipe` | `direction`, `fromY?`, `distance?`, `waitFor?`, `timeoutMs?` | スワイプ。`fromY`指定時の開始xは画面中央 |
| `qa_screenshot` | なし | 画像を取得 |
| `qa_errors` | なし | Dart接続時のFlutter実行時エラー + 端末クラッシュ一覧 |
| `qa_run_start` | `name`, `scenario?`, `app?`, `appVersion?`, `dir?`, `reportLanguage?` | 実行記録を開始し、下記のフォルダーを作成 |
| `qa_step` | `title`, `expected?`, `result`(pass/fail/skip), `actual?`, `note?` | 段階の判定を記録。failで証拠を保存 |
| `qa_run_end` | `summary?` | `report.md`を生成し、結果件数とパスを返す |
| `qa_finish` | なし | 記録を終了し、端末エージェント・mobilecliデーモンを停止して内部接続を切断 |

### 実行記録フォルダー

```text
qa/runs/20260928-112000-TODO-002/
├── meta.json        端末、アプリ・バージョン、gitブランチ・コミット・未コミット状態、Dart接続
├── steps.jsonl      ツール呼び出し（名前・引数・結果・ms）とqa_stepの判定
├── report.md        要約（PASS/FAIL/SKIP・ツールエラー）、期待値・実測値・時間・証拠の表
└── evidence/        失敗時：003-expect-저장.png、.elements.txt（画面要素の原文）、
                     .errors.txt（実行時エラー・クラッシュ）
```

会話には要約とパスだけを返し、トークンを節約します。保存先は`QA_RUNS_DIR`または設定の`runsDir`で変更できます。

### レポートの言語

`qa_run_start`または`qa/qa.config.json`の`reportLanguage`に`en`・`ko`・`ja`を指定します。優先順位は**ツール引数 → プロジェクト設定 → `en`**です。選択した言語は`meta.json`に保存され、実行中の`report.md`の見出しと表のラベルに適用されます。

```text
qa_run_start(name: "TODO-002", reportLanguage: "ja")
```

`run_qa`・`explore_qa`・`report_qa`プロンプトでも`reportLanguage`を指定できます。省略時は対応するユーザーの指定言語・会話言語に従い、それ以外の実行記録にはプロジェクト設定を使います。ステップの説明・要約・UI文字列・証拠は自動翻訳せず、渡された原文を保存します。既存のレポートは変更されません。

**プロンプト**：`plan_qa(feature, depth?, source?)` · `run_qa(scenario, logFile?, allowDanger?, reportLanguage?)` · `explore_qa(area, focus?, logFile?, reportLanguage?)` · `report_qa(scenarios, audience?, reportLanguage?)`

**リソース**：`qa://guides/scenario-format` · `qa://guides/example-schedule-create`

---

## 6. 安全機能とプロジェクト設定

- **危険語によるブロック**：`qa_tap`は、삭제・탈퇴・로그아웃・결제・구매・구독하기・초기화・해지 / Delete・Remove・Log out・Sign out・Purchase・Buy・Subscribe・Pay・Reset・Deactivate / 削除・退会・ログアウト・購入・決済・解約などを確認します。一致する操作には`allowDanger: true`が必要で、取得した要素の実際のアクセシビリティラベルも確認します。
- `qa_tap_xy`では座標上の操作内容を判別できないため、危険語によるブロックは適用されません。先に`qa_screenshot`で確認してください。
- 実アカウントでのQAは実データを作成し、共有・ソーシャル機能では**他のユーザーに通知されることがあります**。QA専用アカウントを使ってください。[他社アプリの注意点](#4-6-他社アプリのqaブラックボックス)も参照してください。

### プロジェクト設定ファイル（任意）

`qa/qa.config.json`にアプリ固有の危険語・ダイアログ規則を設定します。パスは`QA_CONFIG`で変更できます。ファイルがなければ既定値だけを使います。

以下は韓国語UI用の例です。ラベルは対象アプリの言語に合わせてください。

```json
{
  "dangerWords": ["연결 끊기", "계정 전환"],
  "replaceDangerWords": false,
  "dismissRules": [
    { "when": "이벤트", "tap": "오늘 하루 보지 않기" },
    { "when": "", "tap": "나중에" }
  ],
  "runsDir": "qa/runs",
  "reportLanguage": "ja"
}
```

| キー | 説明 |
|---|---|
| `dangerWords` | アプリ固有の危険語を既定リストに**追加** |
| `replaceDangerWords` | `true`なら既定リストを使わず、`dangerWords`のみを使用 |
| `dismissRules` | `qa_dismiss_system`の規則。画面に`when`があれば`tap`を押す。`when: ""`は常に一致。既定規則より**先に**適用 |
| `runsDir` | プロジェクトルートからの相対パスで指定する実行記録フォルダー |
| `reportLanguage` | レポートの見出し・表の言語：`en`（既定）・`ko`・`ja`。`qa_run_start.reportLanguage`引数が優先 |

---

## 7. トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| Dartのタップ・入力が`Timed out waiting for Flutter Driver response` | 広告・Lottieなどの**連続アニメーション**でフレーム同期が待機し続ける | `qa_connect`が自動で`set_frame_sync false`を設定。ドライバーを直接使う場合は先に無効化 |
| 実機のスクリーンショットが`timed out waiting for WebDriverAgent` | エージェント未起動、または開発用ディスクイメージが無効 | 端末をロック解除し、`xcrun devicectl device process launch --device <coredevice-id> com.mobilenext.devicekit-iosUITests.xctrunner`を1回実行してから再試行 |
| `agent is not installed` | エージェント未インストール | [iOS実機の準備](#ios実機)を参照 |
| 文字を送ったのに入力欄が空 | 実機iOSのFlutter入力欄で端末キーボードが表示されない | Dart接続で`qa_type`を使用 |
| `qa_type`が入力後の値を確認できない | フォーカスに失敗した可能性 | `qa_read_screen`で入力欄が隠れていないか確認。必要なら先に`qa_tap`でフォーカス |
| `qa_tap`がタブ名を見つけられない | バッジなどが名前に結合。例：`new\n함께하기` | 通常は部分一致で検索可能。`exact: true`になっていないか確認 |
| `qa_tap`が複数候補を返す | 同じ文字列の要素が複数存在 | 返された`ref`または`index`で再指定。頻発するならアプリにIDを追加 |
| refが消えた・移動したと表示される | 取得後にスクロールやポップアップで画面が変化 | `qa_read_screen`で読み直し、新しいrefを使用 |
| 原因が分からない | 環境とアプリの問題を切り分けられない | `qa_doctor` |
| 初回に何も押せない | iOSの権限ダイアログが前面にある | `qa_dismiss_system` |
| 「Automation Running」が消えない | QA後もエージェントが動作中 | `qa_finish` |
| Dart接続に失敗 | `--print-dtd`なしで起動、または再起動でアドレス変更 | `flutter run … --print-dtd`で起動し直し、新しいログで`qa_connect` |

---

## 8. QAしやすいアプリにする方法

- **アイコンボタンに名前を付ける**：`IconButton(tooltip: '뒤로')`、または`Semantics(label: '뒤로', button: true, child: …)`でカスタムのタップ領域を囲みます。ラベルは実際のUI言語に合わせてください。共通のデザインシステム部品で対応すると、アプリ全体のQAとVoiceOver・TalkBackの使いやすさが向上します。
- **識別子を付ける**：文言・言語変更への耐性を高めます。`qa_read_screen`に`id=…`として表示され、`qa_tap(id: …)`で選べます。
  - Flutter 3.19+：`Semantics(identifier: 'todo_save', child: …)`。iOSのaccessibilityIdentifier / Androidのresource-idとして公開され、Dart接続なしで利用可能。
  - Flutterの`ValueKey('todo_save')`は`qa_tap(key: …)`で使えますが、Dart接続が必要です。
  - ネイティブiOS：`accessibilityIdentifier` / SwiftUIの`.accessibilityIdentifier(…)`。Android：`android:id`、Composeの`Modifier.testTag(…)`と`testTagsAsResourceId`。
- **入力欄にヒント・ラベルを付ける**：`qa_type(field: …)`で見つけられるようにします。
- **QA専用のアカウント・データを用意する**：実ユーザーのデータから分離します。
- **初回ガイドやポップアップを無効化するQAビルド用フラグを設ける**と、シナリオを簡潔にできます。
