# Weekly Planner Frontend 0.1.2

Статический HTML/JS-интерфейс для размещения на GitHub Pages.

## Перед публикацией

В `config.js` указать Google OAuth Client ID:

```js
GOOGLE_CLIENT_ID: "...apps.googleusercontent.com"
```

В Google Cloud Console добавить адрес GitHub Pages в Authorized JavaScript origins.


## Текущие возможности

- Google Sign-In;
- вход только для email из серверного whitelist;
- автоматическое определение роли `user` или `manager`;
- загрузка доступных периодов;
- рабочий интерфейс Planner 0.2.13;
- рабочий интерфейс Manager 0.1.3;
- чтение и сохранение собственного зашифрованного плана;
- менеджерский список пользователей, общий план и распределение задач;
- access token хранится только в памяти вкладки.

Legacy HTML сохранён внутри проекта без серверной части. `planner.html` и `manager.html` загружают рабочие интерфейсы только после проверки API-сессии.

Версия 0.1.1 гарантированно загружает `config.js` и `auth-bridge.js` до запуска legacy-интерфейса. Благодаря этому относительные запросы `/api/...` всегда направляются в Weekly Planner API, а не в GitHub Pages.

Версия 0.1.2 автоматически заполняет строку `Communication` в плане следующей недели: `Hours` содержит сумму длительности встреч, а `Comment` — названия встреч с длительностью в десятичных часах.
