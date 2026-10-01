# Achernar Desktop Pet

这是 Achernar 自有的桌面陪伴与状态反馈模块，替代原先导入的外部宠物包。实现位于 `src/services/desktop-pet.js`、`pet.html`、`pet-workbench.html` 及对应样式中。

宠物状态跟随空闲、思考、工作、语音和 Computer Use 控制状态，并由主进程管理窗口生命周期。它不会注入第三方运行时，也不会从网络下载皮肤或脚本。
