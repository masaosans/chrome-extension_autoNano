Local Browser Agent Design Document

1. 概要
   - 本拡張機能は、Gemini Nanoを活用した自律型ブラウザエージェントです。
   - ユーザーの指示に基づき、AX Tree分析によるページ構造理解と動的な操作実行を実現します。
   - 主な機能：サイドパネル経由でのユーザー入力処理、AI主導のタスク分解・実行、メモリ管理システム


2. 導入方法
chrome://extensions
「パッケージ化されていない拡張機能を読み込む」
フォルダ選択

2. コアアーキテクチャ
   ```mermaid
   graph LR
     A[User Input] --> B(Side Panel)
     B --> C[Background Script]
     C --> D[AI Core Loop]
     C --> E[Memory System]
     D --> F[AX Tree Analysis]
     D --> G[Action Sequence Generation]
     G --> H[Action Execution Layer]
   ```

3. 重要なコンポーネント
   - **manifest.json**: 拡張機能の基盤設定（sidePanel/debuggerアクセス権限を明示的に要求）
   - **background.js**: ユーザー操作の受付窓口
     ```javascript
     chrome.action.onClicked.addListener((tab) => {
       chrome.sidePanel.open({ tabId: tab.id });
       // START_AGENTメッセージを送信する処理がここに存在（省略）
     })
     ```
   - **ai.js**: Gemini Nanoとのインタフェース
     - ユーザー指示を基にしたプロンプト生成
     - AX Treeデータを活用したタスク分解ロジック
     - 例: `const prompt = "■思考の流れ\n1. 現在の目標は何か？..."`
   - **action.js**: DevTools Protocol経由での操作実装
     ```javascript
     case "click": {
       const { object } = await chrome.debugger.sendCommand(
         debuggee, "DOM.resolveNode", { backendNodeId }
       );
       // クリック座標計算の詳細実装
       return new Promise((resolve) => {
         setTimeout(resolve, 800); // DOM安定を待機する遅延処理
       });
     }
     ```
   - **memory.js**: タスク状態管理のためのメモリシステム（writeMemory/deleteMemory）

4. 実行フロー詳細
   ```plaintext
   1. ユーザーがactionボタンをクリック
      → chrome.sidePanel.openでサイドパネル表示
   2. START_AGENTメッセージ受信（userInputを含む）
      → runAgentLoopの実行開始
   3. AIコアループ：
        a) getPageInfo()でAX Tree取得
        b) Gemini Nanoにプロンプト送信
        c) 返却されたJSON配列を順次実行
           - 各actionはexecuteAction関数で処理
           - ページ遷移が発生する操作（navigate）では即時終了（プロンプト指示）
   4. 処理完了後：
        a) STOPメッセージ送信
        b) background.jsが"IDLE"ステータスを通知
   ```

