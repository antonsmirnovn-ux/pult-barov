/* Photos from the staff chat. The normal chat session and server permissions are used. */
"use strict";
class PultTaskPhotos {
  constructor(endpoint, onChange) {
    this.endpoint = endpoint;
    this.onChange = onChange;
    this.storageKey = "pult-photo-session";
    this.token = "";
    this.rejected = "";
    this.generation = 0;
    this.ready = false;
    this.error = "";
    this.byTag = new Map();
    this.allowed = new Map();
    this.media = new Map();
    this.pending = new Map();
    this.observer = typeof IntersectionObserver === "undefined" ? null :
      new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.observer.unobserve(entry.target);
            this.paint(entry.target);
          }
        });
      }, {rootMargin:"160px"});
    window.addEventListener("storage", event => {
      if (event.key === null || [this.storageKey,"chat-session-v1","chat-token"].includes(event.key)) void this.refresh();
    });
  }

  readToken() {
    if (this.memoryToken !== undefined) return this.memoryToken;
    try {
      const own = localStorage.getItem(this.storageKey);
      if (own !== null) return JSON.parse(own) || "";
      const shared = localStorage.getItem("chat-session-v1");
      if (shared !== null) return JSON.parse(shared)?.token || "";
      return JSON.parse(localStorage.getItem("chat-token") || "null") || "";
    } catch (_) { return ""; }
  }
  saveToken(token) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(token || null));
      this.memoryToken = undefined;
    } catch (_) { this.memoryToken = token; }
  }
  reset(token) {
    this.generation++;
    this.token = token;
    this.ready = false;
    this.error = "";
    this.byTag.clear();
    this.allowed.clear();
    this.media.forEach(item => URL.revokeObjectURL(item.url));
    this.media.clear();
    this.pending.clear();
    this.viewer?.close();
    this.observer?.disconnect();
  }
  async call(op, fields, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const response = await fetch(this.endpoint, {
        method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"},
        body:JSON.stringify({...fields,op,token}), redirect:"follow",
        cache:"no-store", credentials:"omit", signal:controller.signal
      });
      if (!response.ok) throw new Error("network");
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "network");
      return result.data;
    } finally { clearTimeout(timer); }
  }
  async refresh() {
    let token = this.readToken();
    if (typeof token !== "string" || token === this.rejected) token = "";
    if (token !== this.token) {
      this.reset(token);
      this.onChange();
    }
    if (!token || this.refreshing === this.generation) return;
    const generation = this.generation;
    this.refreshing = generation;
    try {
      const data = await this.call("sync",{since:0},token);
      if (this.generation !== generation) return;
      const byTag = new Map(), allowed = new Map();
      for (const message of data.msgs || []) {
        if (message.status === "del" || !/^п\d+$/.test(message.tag || "")) continue;
        const files = (message.files || []).filter(file => typeof file.id === "string" && /^image\//i.test(file.type || ""));
        byTag.set(message.tag, files);
        files.forEach(file => allowed.set(file.id, file));
      }
      for (const [id,item] of this.media) {
        if (!allowed.has(id)) {
          URL.revokeObjectURL(item.url);
          this.media.delete(id);
        }
      }
      if (this.viewer && !allowed.has(this.viewer.dataset.file)) this.viewer.close();
      this.byTag = byTag;
      this.allowed = allowed;
      this.ready = true;
      this.error = "";
    } catch (failure) {
      if (this.generation !== generation) return;
      if (failure.message === "auth") {
        this.rejected = token;
        this.reset("");
      } else {
        this.error = "Не удалось загрузить фотографии. Обновите данные.";
      }
    } finally {
      if (this.refreshing === generation) this.refreshing = undefined;
      this.onChange();
    }
  }

  escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char =>
      ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));
  }
  markup(text, detail = false) {
    const tag = /\[(п\d+)\]\s*$/.exec(text)?.[1];
    if (!tag) return "";
    const count = Number(/\(вложений:\s*(\d+),\s*в чате\)/.exec(text)?.[1] || 0);
    const files = this.byTag.get(tag) || [];
    if (!count && !files.length) return "";
    const hint = message => '<span class="task-photo-hint">'+this.escape(message)+'</span>';
    if (!this.token) return detail
      ? '<div class="task-photo-access"><button type="button" class="tbtn" data-sa="photo-login">Войти в чат для просмотра фото</button></div>'
      : hint("📎 Есть вложение");
    if (!this.ready) return hint(this.error || "Загружаем вложения…");
    if (!files.length) return hint(this.byTag.has(tag) ? "Вложение в рабочем чате" : "Вложения недоступны этому аккаунту");
    const tiles = files.map(file => {
      const id = this.escape(file.id);
      const thumb = '<span class="task-photo-thumb" data-pult-image="'+id+'"><span>Фото</span></span>';
      return detail
        ? '<button type="button" class="task-photo-open" data-sa="photo-view" data-photo-id="'+id+'" aria-label="Открыть '+this.escape(file.name)+'">'+thumb+'</button>'
        : thumb;
    }).join("");
    return '<span class="task-photo-row'+(detail?' task-photo-detail':'')+'">'+tiles+'</span>';
  }
  observe() {
    this.observer?.disconnect();
    document.querySelectorAll("[data-pult-image]").forEach(element => {
      if (this.observer) this.observer.observe(element);
      else this.paint(element);
    });
  }
  async getMedia(id) {
    const file = this.allowed.get(id);
    if (!file || !this.token) throw new Error("forbidden");
    if (this.media.has(id)) return this.media.get(id);
    if (this.pending.has(id)) return this.pending.get(id);
    const generation = this.generation;
    const pending = this.call("photo",{id},this.token).then(data => {
      if (generation !== this.generation || !this.allowed.has(id)) throw new Error("auth");
      const match = /^data:([\w./+-]+);base64,([\s\S]*)$/.exec(data);
      if (!match) throw new Error("bad_photo");
      const raw = atob(match[2]), bytes = new Uint8Array(raw.length);
      for (let i=0; i<raw.length; i++) bytes[i]=raw.charCodeAt(i);
      const item = {url:URL.createObjectURL(new Blob([bytes],{type:match[1]})),name:file.name};
      this.media.set(id,item);
      return item;
    }).finally(() => {
      if (this.pending.get(id) === pending) this.pending.delete(id);
    });
    this.pending.set(id,pending);
    return pending;
  }
  async paint(element) {
    const id = element.dataset.pultImage;
    try {
      const item = await this.getMedia(id);
      if (!element.isConnected || !this.allowed.has(id)) return;
      const image = document.createElement("img");
      image.alt = "";
      image.onerror = () => { element.textContent = "Открыть фото"; };
      image.src = item.url;
      element.replaceChildren(image);
    } catch (_) {
      if (element.isConnected) element.textContent = "Фото не загрузилось";
    }
  }
  dialog(title) {
    const dialog = document.createElement("dialog");
    dialog.className = "pult-photo-dialog";
    dialog.setAttribute("aria-label",title);
    dialog.addEventListener("close",()=>dialog.remove(),{once:true});
    document.body.append(dialog);
    return dialog;
  }
  openLogin() {
    const dialog = this.dialog("Вход в рабочий чат");
    dialog.innerHTML = '<div class="photo-dialog-head"><b>Фото из рабочего чата</b><button type="button" aria-label="Закрыть">×</button></div>'+
      '<form class="photo-login"><label>Код доступа<input name="pin" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="32" required></label>'+
      '<p class="task-photo-hint">Достаточно войти один раз на этом устройстве.</p><p class="photo-login-error" role="alert" hidden></p><button class="sbtn ok" type="submit">Войти</button></form>';
    dialog.querySelector(".photo-dialog-head button").onclick = () => dialog.close();
    const form = dialog.querySelector("form");
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector("[type=submit]"), error = form.querySelector("[role=alert]");
      const pin = form.elements.pin.value.trim();
      if (!pin || button.disabled) return;
      button.disabled = true;
      error.hidden = true;
      try {
        const result = await this.call("login",{pin},"");
        if (!dialog.isConnected) return;
        if (typeof result.token !== "string" || !result.token) throw new Error("network");
        this.rejected = "";
        this.saveToken(result.token);
        dialog.close();
        await this.refresh();
      } catch (failure) {
        if (dialog.isConnected) {
          error.textContent = failure.message === "bad_pin" ? "Неверный код доступа." :
            failure.message === "locked" ? "Много попыток. Повторите через 15 минут." : "Не удалось войти. Попробуйте ещё раз.";
          error.hidden = false;
        }
      } finally { button.disabled = false; }
    };
    dialog.showModal();
  }
  async openViewer(id) {
    const file = this.allowed.get(id);
    if (!file) return;
    const dialog = this.dialog("Фото");
    this.viewer = dialog;
    dialog.dataset.file = id;
    dialog.innerHTML = '<div class="photo-dialog-head"><b>'+this.escape(file.name)+'</b><button type="button" aria-label="Закрыть">×</button></div><div class="photo-view-content">Загружаем фото…</div>';
    dialog.querySelector("button").onclick = () => dialog.close();
    dialog.addEventListener("close",()=>{if(this.viewer===dialog)this.viewer=null;},{once:true});
    dialog.showModal();
    const content=dialog.querySelector(".photo-view-content");
    try {
      const item = await this.getMedia(id);
      if (!dialog.isConnected || !this.allowed.has(id)) return;
      const image = document.createElement("img");
      image.alt = file.name;
      const save = document.createElement("a");
      save.href=item.url; save.download=file.name; save.textContent="Скачать фото"; save.className="tbtn";
      image.onerror=()=>{image.replaceWith(document.createTextNode("Этот формат фото можно скачать."));};
      image.src=item.url;
      content.replaceChildren(image,save);
    } catch (_) {
      if (dialog.isConnected) content.textContent="Не удалось загрузить фото. Откройте его повторно.";
    }
  }
  signOut() {
    this.saveToken("");
    this.reset("");
    this.onChange();
  }
}
