const modules = [
  { key: "photos", name: "原始照片", folder: "01_原始照片" },
  { key: "ocr", name: "OCR文字", folder: "02_OCR文字" },
  { key: "labs", name: "检查检验", folder: "03_检查检验" },
  { key: "progress", name: "病程素材", folder: "04_病程素材" },
  { key: "drafts", name: "Codex草稿", folder: "05_Codex草稿" },
  { key: "final", name: "最终病历", folder: "06_最终病历" }
];

const categoryMap = {
  in: "在院患者",
  out: "出院患者"
};

const state = {
  category: "in",
  selectedPatientId: "",
  directoryHandle: null,
  deferredInstall: null
};

const els = {
  installBtn: document.querySelector("#installBtn"),
  tabs: [...document.querySelectorAll("[data-category]")],
  patientSelect: document.querySelector("#patientSelect"),
  nameInput: document.querySelector("#nameInput"),
  hospitalNoInput: document.querySelector("#hospitalNoInput"),
  diagnosisInput: document.querySelector("#diagnosisInput"),
  createPatientBtn: document.querySelector("#createPatientBtn"),
  pickFolderBtn: document.querySelector("#pickFolderBtn"),
  folderStatus: document.querySelector("#folderStatus"),
  modules: document.querySelector("#modules"),
  moduleTemplate: document.querySelector("#moduleTemplate"),
  records: document.querySelector("#records"),
  recordTemplate: document.querySelector("#recordTemplate"),
  refreshRecordsBtn: document.querySelector("#refreshRecordsBtn"),
  exportIndexBtn: document.querySelector("#exportIndexBtn")
};

const patientKey = "medical_collector_patients_v1";
const dbName = "medical_collector_db";
const storeName = "records";

function safeName(value) {
  return String(value || "未命名").trim().replace(/[\\/:*?"<>|\s]+/g, "_");
}

function nowStamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function getPatients() {
  return JSON.parse(localStorage.getItem(patientKey) || "[]");
}

function savePatients(patients) {
  localStorage.setItem(patientKey, JSON.stringify(patients));
}

function currentPatients() {
  return getPatients().filter((patient) => patient.category === state.category);
}

function currentPatient() {
  return getPatients().find((patient) => patient.id === state.selectedPatientId) || currentPatients()[0] || null;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(storeName, { keyPath: "id" });
      store.createIndex("patientId", "patientId");
      store.createIndex("createdAt", "createdAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addRecord(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function listRecords(patientId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => {
      const records = request.result
        .filter((item) => !patientId || item.patientId === patientId)
        .sort((a, b) => b.createdAt - a.createdAt);
      resolve(records);
    };
    request.onerror = () => reject(request.error);
  });
}

async function writeFileToDirectory(record) {
  if (!state.directoryHandle) return false;
  const categoryDir = await state.directoryHandle.getDirectoryHandle(categoryMap[record.category], { create: true });
  const patientDir = await categoryDir.getDirectoryHandle(record.patientFolder, { create: true });
  const moduleDir = await patientDir.getDirectoryHandle(record.moduleFolder, { create: true });
  const fileHandle = await moduleDir.getFileHandle(record.fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(record.blob);
  await writable.close();
  return true;
}

function renderPatients() {
  const patients = currentPatients();
  els.patientSelect.innerHTML = "";

  if (!patients.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无患者，请先新建";
    els.patientSelect.append(option);
    state.selectedPatientId = "";
    return;
  }

  patients.forEach((patient) => {
    const option = document.createElement("option");
    option.value = patient.id;
    option.textContent = patient.folder;
    els.patientSelect.append(option);
  });

  if (!patients.some((patient) => patient.id === state.selectedPatientId)) {
    state.selectedPatientId = patients[0].id;
  }
  els.patientSelect.value = state.selectedPatientId;
}

function renderModules() {
  els.modules.innerHTML = "";
  modules.forEach((module) => {
    const node = els.moduleTemplate.content.cloneNode(true);
    node.querySelector("h2").textContent = module.name;
    node.querySelector("p").textContent = module.folder;
    const input = node.querySelector("input");
    input.addEventListener("change", () => handleFiles(module, input.files));
    els.modules.append(node);
  });
}

async function renderRecords() {
  const patient = currentPatient();
  const records = await listRecords(patient ? patient.id : "");
  els.records.innerHTML = "";
  if (!records.length) {
    els.records.textContent = "暂无采集记录。";
    return;
  }

  for (const record of records.slice(0, 30)) {
    const node = els.recordTemplate.content.cloneNode(true);
    const url = URL.createObjectURL(record.blob);
    node.querySelector("img").src = url;
    node.querySelector("strong").textContent = record.moduleName;
    node.querySelector("p").textContent = `${record.patientFolder}/${record.moduleFolder}/${record.fileName}`;
    node.querySelector(".download").addEventListener("click", () => {
      const link = document.createElement("a");
      link.href = url;
      link.download = record.fileName;
      link.click();
    });
    els.records.append(node);
  }
}

function render() {
  renderPatients();
  renderModules();
  renderRecords();
}

function createPatient() {
  const name = els.nameInput.value.trim();
  if (!name) {
    alert("请填写姓名或代号。");
    return;
  }

  const hospitalNo = els.hospitalNoInput.value.trim();
  const diagnosis = els.diagnosisInput.value.trim();
  const folder = [name, hospitalNo, diagnosis].filter(Boolean).map(safeName).join("_");
  const patient = {
    id: `p_${Date.now()}`,
    category: state.category,
    name,
    hospitalNo,
    diagnosis,
    folder,
    createdAt: Date.now()
  };

  const patients = getPatients();
  patients.unshift(patient);
  savePatients(patients);
  state.selectedPatientId = patient.id;
  els.nameInput.value = "";
  els.hospitalNoInput.value = "";
  els.diagnosisInput.value = "";
  render();
}

async function handleFiles(module, files) {
  const patient = currentPatient();
  if (!patient) {
    alert("请先选择或新建患者。");
    return;
  }
  if (!files || !files.length) return;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const ext = file.name.match(/\.[a-zA-Z0-9]+$/)?.[0] || ".jpg";
    const fileName = `${nowStamp()}_${module.name}_${index + 1}${ext}`;
    const record = {
      id: `r_${Date.now()}_${index}`,
      category: patient.category,
      patientId: patient.id,
      patientFolder: patient.folder,
      moduleKey: module.key,
      moduleName: module.name,
      moduleFolder: module.folder,
      fileName,
      type: file.type,
      size: file.size,
      createdAt: Date.now(),
      blob: file
    };

    await addRecord(record);
    try {
      await writeFileToDirectory(record);
    } catch (error) {
      console.warn("写入手机文件夹失败：", error);
    }
  }

  await renderRecords();
  alert("已保存到本地资料库。浏览器支持时也已写入所选手机文件夹。");
}

async function pickFolder() {
  if (!window.showDirectoryPicker) {
    els.folderStatus.textContent = "当前浏览器不支持直接选择文件夹写入。资料会保存在浏览器本地资料库，可逐个下载或后续导出。";
    return;
  }

  state.directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
  els.folderStatus.textContent = "已选择手机文件夹。之后拍照会按 在院/出院 - 患者 - 模块 自动分类写入。";
}

async function exportIndex() {
  const records = await listRecords();
  const index = records.map(({ blob, ...rest }) => rest);
  const text = JSON.stringify({ exportedAt: new Date().toISOString(), records: index }, null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `病历采集索引_${nowStamp()}.json`;
  link.click();
}

els.tabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.category = button.dataset.category;
    els.tabs.forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
});

els.patientSelect.addEventListener("change", () => {
  state.selectedPatientId = els.patientSelect.value;
  renderRecords();
});

els.createPatientBtn.addEventListener("click", createPatient);
els.pickFolderBtn.addEventListener("click", () => pickFolder().catch((error) => alert(error.message)));
els.refreshRecordsBtn.addEventListener("click", renderRecords);
els.exportIndexBtn.addEventListener("click", () => exportIndex().catch((error) => alert(error.message)));

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstall = event;
  els.installBtn.hidden = false;
});

els.installBtn.addEventListener("click", async () => {
  if (!state.deferredInstall) return;
  state.deferredInstall.prompt();
  await state.deferredInstall.userChoice;
  state.deferredInstall = null;
  els.installBtn.hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

render();

