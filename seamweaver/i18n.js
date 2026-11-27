// 界面文字：中文 / 日本語 / English。方块和事件的名字来自音乐包（中文），显示时按下面的表替换。
const S = {
  zh: {
    stop: '停止', play: '播放', preroll: '从出口前', prerollUnit: '小节听起', loop: '循环试听', thickness: '配器厚度',
    chain: '连播', clear: '清空', undo: '撤销', reset: '全部还原', help: '怎么用', survey: '任务与问卷',
    channels: '从这里可以去', loopSelf: '循环（回到自己）', bridgeTo: '接口 → ', viaBridge: '经接口', bars: '小节', bar: '第 {n} 小节', tail: '曲尾',
    idle: '点一个方块，看它能切到哪里', nowPlaying: '正在播放', selLink: '连线', deleteLink: '删除这条连线', linkDeleted: '已删除连线', linkAdded: '已添加连线',
    hintSelected: '点彩色连线试听切换 · 按住 Alt 依次点连线或目标方块 = 选一条路径 · 从小节下方的圆点拖到别的方块 = 新连线',
    hintChannel: '只显示这一条通道 · 点空白处取消', hintChain: '已选 {n} 段路径 · 点「连播」一口气听完',
    editor: '编辑', closeEditor: '关闭', playBlock: '播放这个方块', playFromSource: '从来源小节听过来', resetBlock: '还原这个方块', ghost: '显示其他轨',
    edHint: '点空白处添加音符 · 拖动移动 · 拖右边缘改长短 · 双击或 Delete 删除',
    confirmReset: '把所有连线和音符恢复成原样？你做的修改会丢失。', audioOff: '点任意位置启用声音',
    helpTitle: '三分钟上手',
    helpItems: [
      '每个方块是一段音乐：上面一排是探索时的主题曲，中间一排是过渡小节（接口），下面一排是 Boss 战的乐段。',
      '点一个方块，它能去的地方会按目的地分成不同颜色。点右上角的颜色，只看那一条通道。',
      '点一条彩色连线，就会从出口前一小节播起，在小节线上切过去，让你听到这次切换。',
      '按住 Alt 依次点连线（或目标方块），可以排出一条路径；再点上方的「连播」一口气听完。',
      '从小节下方的小圆点拖到另一个方块，就新建了一条连线；选中连线后按 Delete 删除。',
      '点方块上的铅笔，可以在下方的钢琴卷帘里改这个方块的音符，改完马上就能试听。',
      '看图：滚轮或拖空白处 = 平移；按住 Win 键（Mac 上是 ⌘）再滚滚轮 = 放大缩小；按住方块拖动 = 把它挪到顺手的位置。',
      '如果声音出现失真或爆音，刷新一下网页就会恢复；你做的修改不会丢。',
    ],
    helpOk: '开始', dontShow: '可以随时点右上角「怎么用」再看',
    drums: { 36: '底鼓', 38: '军鼓', 42: '闭镲', 46: '开镲', 49: '吊镲', 41: '低音重击', 37: '闷击' },
  },
  ja: {
    stop: '停止', play: '再生', preroll: '出口の', prerollUnit: '小節前から聴く', loop: 'ループ試聴', thickness: '編成の厚み',
    chain: '連続再生', clear: 'クリア', undo: '元に戻す', reset: 'すべて初期化', help: '使い方', survey: '課題とアンケート',
    channels: 'ここからの行き先', loopSelf: 'ループ（自分に戻る）', bridgeTo: 'ブリッジ → ', viaBridge: 'ブリッジ経由', bars: '小節', bar: '第 {n} 小節', tail: '曲の終わり',
    idle: 'ブロックをクリックすると、切り替え先が表示されます', nowPlaying: '再生中', selLink: '接続', deleteLink: 'この接続を削除', linkDeleted: '接続を削除しました', linkAdded: '接続を追加しました',
    hintSelected: '色付きの線をクリックで切り替えを試聴 · Alt を押しながら線や行き先を順にクリック = 経路を選択 · 小節の下の丸を別のブロックへドラッグ = 新しい接続',
    hintChannel: 'この経路だけを表示中 · 空白をクリックで解除', hintChain: '{n} 区間を選択中 ·「連続再生」で通して聴く',
    editor: '編集', closeEditor: '閉じる', playBlock: 'このブロックを再生', playFromSource: '元の小節から聴く', resetBlock: 'このブロックを初期化', ghost: '他のトラックを表示',
    edHint: '空白をクリックで音符を追加 · ドラッグで移動 · 右端をドラッグで長さ変更 · ダブルクリックまたは Delete で削除',
    confirmReset: 'すべての接続と音符を初期状態に戻しますか？変更内容は失われます。', audioOff: 'クリックすると音が出ます',
    helpTitle: '3 分でわかる使い方',
    helpItems: [
      'ブロックひとつが音楽のひとかたまりです。上段は探索中のテーマ曲、中段はつなぎの小節（ブリッジ）、下段はボス戦の各セクションです。',
      'ブロックをクリックすると、行き先ごとに線が色分けされます。右上の色をクリックすると、その経路だけが表示されます。',
      '色付きの線をクリックすると、出口の 1 小節前から再生し、小節線で切り替わる様子を聴けます。',
      'Alt を押しながら線（または行き先のブロック）を順にクリックすると経路ができます。上の「連続再生」で通して聴けます。',
      '小節の下の小さな丸を別のブロックへドラッグすると、新しい接続ができます。接続を選んで Delete で削除します。',
      'ブロックの鉛筆をクリックすると、下のピアノロールで音符を編集できます。編集後すぐに試聴できます。',
      '画面の操作：ホイールまたは空白のドラッグ = 移動、Win キー（Mac は ⌘）を押しながらホイール = 拡大・縮小、ブロックをドラッグ = 好きな位置に動かす。',
      '音が歪んだりノイズが入ったりした場合は、ページを再読み込みすると直ります。変更内容は消えません。',
    ],
    helpOk: 'はじめる', dontShow: '右上の「使い方」からいつでも見られます',
    drums: { 36: 'キック', 38: 'スネア', 42: 'ハット（閉）', 46: 'ハット（開）', 49: 'クラッシュ', 41: '低音の一撃', 37: 'ミュート打' },
  },
  en: {
    stop: 'Stop', play: 'Play', preroll: 'Start', prerollUnit: 'bar(s) before the exit', loop: 'Loop audition', thickness: 'Arrangement density',
    chain: 'Play path', clear: 'Clear', undo: 'Undo', reset: 'Reset all', help: 'How to use', survey: 'Tasks & survey',
    channels: 'From here you can go to', loopSelf: 'Loop (back to itself)', bridgeTo: 'Bridge → ', viaBridge: 'via bridge', bars: 'bars', bar: 'bar {n}', tail: 'end',
    idle: 'Click a block to see where it can switch to', nowPlaying: 'Now playing', selLink: 'Link', deleteLink: 'Delete this link', linkDeleted: 'Link deleted', linkAdded: 'Link added',
    hintSelected: 'Click a coloured link to audition the switch · Alt-click links or target blocks in order = build a path · Drag from the dot under a bar onto another block = new link',
    hintChannel: 'Showing this route only · click empty space to cancel', hintChain: '{n} segment(s) selected · press “Play path” to hear them in one go',
    editor: 'Edit', closeEditor: 'Close', playBlock: 'Play this block', playFromSource: 'Hear it from the source bar', resetBlock: 'Reset this block', ghost: 'Show other tracks',
    edHint: 'Click empty space to add a note · drag to move · drag the right edge to resize · double-click or Delete to remove',
    confirmReset: 'Restore all links and notes to the original? Your changes will be lost.', audioOff: 'Click anywhere to enable sound',
    helpTitle: 'Three-minute guide',
    helpItems: [
      'Each block is a piece of music: the top row is the exploration theme, the middle row holds the transition bars (bridges), the bottom row the boss-battle sections.',
      'Click a block and its outgoing links are coloured by destination. Click a colour at the top right to show only that route.',
      'Click a coloured link: playback starts one bar before the exit and switches on the bar line, so you hear the transition.',
      'Hold Alt and click links (or target blocks) in order to build a path, then press “Play path” to hear it in one go.',
      'Drag from the small dot under a bar onto another block to create a link. Select a link and press Delete to remove it.',
      'Click the pencil on a block to edit its notes in the piano roll below, and audition right away.',
      'Navigating: wheel or drag empty space = pan; hold the Win key (⌘ on a Mac) and scroll = zoom; drag a block = move it wherever suits you.',
      'If the sound becomes distorted or crackly, reload the page and it will recover; your changes are kept.',
    ],
    helpOk: 'Start', dontShow: 'You can reopen this from “How to use” at the top right',
    drums: { 36: 'Kick', 38: 'Snare', 42: 'Closed hat', 46: 'Open hat', 49: 'Crash', 41: 'Low boom', 37: 'Thunk' },
  },
};
// 音乐包里的中文名 → 其他语言。长的词排前面。
const NAMES = [
  ['开场八音盒', 'オルゴールの導入', 'Music-box intro'], ['胜利收束', '勝利のコーダ', 'Victory coda'], ['失败收束', '敗北のコーダ', 'Defeat coda'],
  ['第一乐段', '第 1 セクション', 'Section 1'], ['第二乐段', '第 2 セクション', 'Section 2'], ['终乐段', '最終セクション', 'Final section'],
  ['主题曲', 'テーマ曲', 'Theme'], ['接口', 'ブリッジ', 'Bridge'],
  ['摇篮曲', '子守歌', 'Lullaby'], ['星形舞曲', '星形の舞曲', 'Star Dance'], ['蔷薇帕凡', '薔薇のパヴァーヌ', 'Rose Pavane'], ['晚祷', '晩祷', 'Vespers'], ['斐波那契', 'フィボナッチ', 'Fibonacci'],
  ['单场开战', '単独戦の開始', 'Single-fight start'], ['开战', '戦闘開始', 'Battle start'], ['换区', 'エリア移動', 'Area change'], ['转阶段', 'フェーズ移行', 'Next phase'],
  ['胜利', '勝利', 'Victory'], ['失败', '敗北', 'Defeat'], ['回探索', '探索に戻る', 'Back to exploring'], ['循环', 'ループ', 'Loop'], ['自定', 'カスタム', 'Custom'],
  ['旋律叠音', '旋律の重ね', 'Melody double'], ['低八度钟', '低オクターブの鐘', 'Low-octave bell'], ['预告拨弦', '予告のハープ', 'Preview harp'], ['预告钟', '予告の鐘', 'Preview bell'],
  ['脉冲和弦', 'パルス和音', 'Pulse chords'], ['旋律', '旋律', 'Melody'], ['贝斯', 'ベース', 'Bass'], ['琶音', 'アルペジオ', 'Arpeggio'], ['铺底', 'パッド', 'Pad'], ['鼓', 'ドラム', 'Drums'],
];
export const LANGS = ['zh', 'ja', 'en'];
let cur = 'zh';
try { const s = localStorage.getItem('seam.lang'); if (LANGS.includes(s)) cur = s; else if (navigator.language.startsWith('ja')) cur = 'ja'; else if (!navigator.language.startsWith('zh')) cur = 'en'; } catch {}
export const lang = () => cur;
export function setLang(l) { cur = l; try { localStorage.setItem('seam.lang', l); } catch {} }
export function T(key, vars) {
  let s = S[cur][key] ?? S.zh[key] ?? key;
  if (vars && typeof s === 'string') for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  return s;
}
/** 把音乐包里的名字换成当前语言。 */
export function N(name) {
  if (cur === 'zh' || !name) return name;
  const col = cur === 'ja' ? 1 : 2;
  let out = name;
  for (const row of NAMES) out = out.split(row[0]).join(row[col]);
  return out;
}
