'use strict';
const locales = ['en', 'zh-CN', 'ja', 'ko', 'es', 'ru'];
function resolveLocale(value = 'auto', env = process.env) {
  const input =
    value && value !== 'auto'
      ? value
      : env.ACHERNAR_LANGUAGE ||
        env.LC_ALL ||
        env.LC_MESSAGES ||
        env.LANG ||
        Intl.DateTimeFormat().resolvedOptions().locale;
  const base = String(input).replace('_', '-').split(/[.-]/)[0].toLowerCase();
  return { zh: 'zh-CN', ja: 'ja', ko: 'ko', es: 'es', ru: 'ru', en: 'en' }[base] || 'en';
}
// English keys stay stable for scripts and keyboard commands. Only host labels
// pass through this table; model output and source files never do.
const rows = {
  Code: ['编程', 'コード', '코드', 'Código'],
  Plan: ['规划', '計画', '계획', 'Plan'],
  Review: ['审查', 'レビュー', '검토', 'Revisión'],
  Strict: ['全部询问', '毎回確認', '항상 확인', 'Estricto'],
  Auto: ['自动批准', '自動承認', '자동 승인', 'Automático'],
  Thinking: ['思考中', '思考中', '생각 중', 'Pensando'],
  Connecting: ['连接中', '接続中', '연결 중', 'Conectando'],
  Working: ['执行中', '実行中', '작업 중', 'Trabajando'],
  Responding: ['回复中', '回答中', '응답 중', 'Respondiendo'],
  'Compacting context': ['压缩上下文', '文脈を圧縮中', '문맥 압축 중', 'Resumiendo contexto'],
  'Context compacted': [
    '上下文已压缩',
    '文脈を圧縮しました',
    '문맥 압축 완료',
    'Contexto resumido',
  ],
  Running: ['运行中', '実行中', '실행 중', 'Ejecutando'],
  Stopped: ['已停止', '停止', '중지됨', 'Detenido'],
  Failed: ['失败', '失敗', '실패', 'Falló'],
  Done: ['完成', '完了', '완료', 'Listo'],
  Completed: ['已完成', '完了', '완료됨', 'Completado'],
  You: ['你', 'あなた', '사용자', 'Tú'],
  Result: ['结果', '結果', '결과', 'Resultado'],
  Activity: ['操作', '操作', '작업', 'Actividad'],
  'Task plan': ['任务计划', 'タスク計画', '작업 계획', 'Plan de tarea'],
  'Console output': ['控制台输出', 'コンソール出力', '콘솔 출력', 'Salida de consola'],
  'Console / result': ['输出 / 结果', '出力 / 結果', '출력 / 결과', 'Consola / resultado'],
  'No model selected': ['尚未选择模型', 'モデル未選択', '모델 미선택', 'Sin modelo seleccionado'],
  'Your choice': ['等待你的选择', '選択してください', '선택해 주세요', 'Tu elección'],
  'Describe a task, or type / for commands…': [
    '描述任务，或输入 / 选择命令…',
    'タスクを入力、または / でコマンド…',
    '작업을 입력하거나 / 로 명령 선택…',
    'Describe una tarea, o escribe / para comandos…',
  ],
  'Type to filter choices…': [
    '输入以筛选选项…',
    '入力して候補を絞り込む…',
    '입력하여 선택 항목 필터링…',
    'Escribe para filtrar opciones…',
  ],
  'Add a correction… Enter queues · Esc stops': [
    '补充要求… Enter 加入队列 · Esc 停止',
    '追加の指示… Enter 送信 · Esc 停止',
    '추가 지시… Enter 대기열 · Esc 중지',
    'Añade una corrección… Enter envía · Esc detiene',
  ],
  'Type an answer and press Enter…': [
    '输入回答并按 Enter…',
    '回答を入力して Enter…',
    '답변 입력 후 Enter…',
    'Escribe una respuesta y pulsa Enter…',
  ],
  'Commands & Skills': [
    '命令与 Skills',
    'コマンドと Skills',
    '명령 및 Skills',
    'Comandos y Skills',
  ],
  'No matching entries': ['没有匹配项', '一致する項目なし', '일치 항목 없음', 'Sin coincidencias'],
  'Filter…': ['筛选…', '絞り込み…', '필터…', 'Filtrar…'],
  'Type your answer…': ['输入回答…', '回答を入力…', '답변 입력…', 'Tu respuesta…'],
  'Select model': ['选择模型', 'モデルを選択', '모델 선택', 'Seleccionar modelo'],
  'Current model': ['当前模型', '現在のモデル', '현재 모델', 'Modelo actual'],
  '+ Create model': ['+ 添加模型', '+ モデルを追加', '+ 모델 추가', '+ Crear modelo'],
  '+ Model ID': ['+ 模型 ID', '+ モデル ID', '+ 모델 ID', '+ ID de modelo'],
  'Edit configuration': ['编辑配置', '設定を編集', '설정 편집', 'Editar configuración'],
  'Runtime settings': ['运行设置', '実行設定', '실행 설정', 'Ajustes de ejecución'],
  Enabled: ['开启', '有効', '활성', 'Activado'],
  Disabled: ['关闭', '無効', '비활성', 'Desactivado'],
  Sessions: ['会话记录', 'セッション', '세션', 'Sesiones'],
  'Session actions': ['会话操作', 'セッション操作', '세션 작업', 'Acciones de sesión'],
  'Resume session': ['恢复会话', 'セッション再開', '세션 재개', 'Reanudar sesión'],
  'Delete session': ['删除会话', 'セッション削除', '세션 삭제', 'Eliminar sesión'],
  'Keep session': ['保留会话', 'セッションを保持', '세션 유지', 'Conservar sesión'],
  'Back to sessions': ['返回会话列表', '一覧に戻る', '세션 목록으로', 'Volver a sesiones'],
  'Delete this session?': [
    '删除此会话？',
    'このセッションを削除？',
    '이 세션을 삭제할까요?',
    '¿Eliminar esta sesión?',
  ],
  'Allow once': ['允许一次', '今回のみ許可', '한 번 허용', 'Permitir una vez'],
  Deny: ['拒绝', '拒否', '거부', 'Denegar'],
  Permission: ['操作审批', '操作の確認', '작업 승인', 'Permiso'],
  'Review file change': ['审阅文件更改', 'ファイル変更を確認', '파일 변경 검토', 'Revisar cambio'],
  'Run this operation': ['执行此操作', 'この操作を実行', '이 작업 실행', 'Ejecutar esta operación'],
  'Skip this operation': [
    '跳过此操作',
    'この操作をスキップ',
    '이 작업 건너뛰기',
    'Omitir esta operación',
  ],
  'Ask for all operations': [
    '每次操作都询问',
    'すべての操作を確認',
    '모든 작업 확인',
    'Preguntar siempre',
  ],
  'Auto-approve code edits; ask for others': [
    '代码免审，其他询问',
    'コード編集以外は確認',
    '코드 편집 외에는 확인',
    'Aprobar código; preguntar lo demás',
  ],
  'Approve all operations': [
    '自动批准所有操作',
    'すべて自動承認',
    '모든 작업 자동 승인',
    'Aprobar todas las operaciones',
  ],
  'Command shell': ['命令终端', 'シェル', '명령 셸', 'Shell'],
  'Terminal isolation': ['执行限制', '実行制限', '실행 제한', 'Límites de ejecución'],
  'Fallback models': ['备用模型', '代替モデル', '대체 모델', 'Modelos de respaldo'],
  Language: ['界面语言', '言語', '언어', 'Idioma'],
  'Enter next · Esc previous step': [
    'Enter 下一步 · Esc 上一步',
    'Enter 次へ · Esc 戻る',
    'Enter 다음 · Esc 이전',
    'Enter siguiente · Esc anterior',
  ],
  'Enter choose · Esc back · Hover / click': [
    'Enter 选择 · Esc 返回 · 支持鼠标',
    'Enter 選択 · Esc 戻る · マウス対応',
    'Enter 선택 · Esc 뒤로 · 마우스 지원',
    'Enter elegir · Esc volver · Ratón',
  ],
  '↑↓ choose · Enter confirm · Esc deny': [
    '↑↓ 选择 · Enter 确认 · Esc 拒绝',
    '↑↓ 選択 · Enter 確認 · Esc 拒否',
    '↑↓ 선택 · Enter 확인 · Esc 거부',
    '↑↓ elegir · Enter confirmar · Esc denegar',
  ],
  'Enter send · Alt+Enter newline · / commands · PgUp/PgDn scroll': [
    'Enter 发送 · Alt+Enter 换行 · / 命令 · PgUp/PgDn 滚动',
    'Enter 送信 · Alt+Enter 改行 · / コマンド · PgUp/PgDn スクロール',
    'Enter 전송 · Alt+Enter 줄바꿈 · / 명령 · PgUp/PgDn 스크롤',
    'Enter enviar · Alt+Enter nueva línea · / comandos · PgUp/PgDn desplazar',
  ],
  'MAKE ROOM FOR YOUR NEXT IDEA': [
    '为下一个想法留出空间',
    '次のアイデアをかたちに',
    '다음 아이디어를 위한 공간',
    'DA ESPACIO A TU PRÓXIMA IDEA',
  ],
  Used: ['已用', '使用済み', '사용량', 'Usados'],
  Context: ['上下文', '文脈', '문맥', 'Contexto'],
  Cost: ['费用', '費用', '비용', 'Coste'],
};
function translate(locale, text) {
  const index = locales.indexOf(locale) - 1;
  if (index < 0 || typeof text !== 'string') return text;
  const extra = require('./i18n-extra'),
    extraIndex = ['zh-CN', 'ru', 'ja'].indexOf(locale);
  if (extraIndex >= 0 && extra.rows[text]) return extra.rows[text][extraIndex];
  if (locale === 'ru' && extra.russian[text]) return extra.russian[text];
  if (rows[text]?.[index]) return rows[text][index];
  // Host label compositions contain distinct separators, not arbitrary content.
  if (text.includes('\n'))
    return text
      .split('\n')
      .map((line) => translate(locale, line))
      .join('\n');
  if (text.includes(' · '))
    return text
      .split(' · ')
      .map((part) => translate(locale, part))
      .join(' · ');
  const icon = /^([▸▾◉+]\s+)(.+)$/.exec(text);
  if (icon) return icon[1] + translate(locale, icon[2]);
  const prefix = /^([^:\n]+): (.*)$/.exec(text);
  if (prefix) {
    const label = translate(locale, prefix[1]);
    if (label !== prefix[1]) return label + ': ' + prefix[2];
  }
  for (const state of ['expanded', 'collapsed'])
    if (text.endsWith(' ' + state))
      return translate(locale, text.slice(0, -state.length - 1)) + ' ' + translate(locale, state);
  return text;
}
module.exports = { locales, resolveLocale, translate };
