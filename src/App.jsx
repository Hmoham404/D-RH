import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { analyzePointageFile } from './lib/pointageImport';
import {
  createEmptyEmployee,
  deleteEmployeeRecord,
  loadEmployees,
  saveEmployeeRecord,
} from './services/employeeStore';
import { loadPointageSnapshot, replacePointageSnapshot } from './services/pointageSnapshotStore';

const mycLogoUrl = new URL('../MYC beauty innovation TUNISIA @300x-100.png', import.meta.url).href;
const rhManagerAvatarUrl = new URL('./assets/rh-manager-avatar.svg', import.meta.url).href;
const LANGUAGE_STORAGE_KEY = 'rh-dashboard-language';
const LANGUAGE_OPTIONS = [
  { key: 'fr', shortLabel: 'FR', label: 'Francais' },
  { key: 'ar', shortLabel: 'AR', label: 'العربية' },
  { key: 'en', shortLabel: 'EN', label: 'English' },
  { key: 'it', shortLabel: 'IT', label: 'Italiano' },
  { key: 'zh', shortLabel: 'ZH', label: '中文' },
];
const LANGUAGE_LOCALES = {
  fr: 'fr-FR',
  ar: 'ar-TN',
  en: 'en-US',
  it: 'it-IT',
  zh: 'zh-CN',
};
const UI_TRANSLATIONS = {
  fr: {
    topbar: {
      language: 'Langue',
      dateSelected: 'Date selectionnee',
      noDate: 'Aucune date',
      menu: 'Menu',
      userRole: 'RH Manager',
      userCompany: 'MYC Beauty',
    },
    sidebar: {
      navigation: 'Navigation',
      aria: 'Navigation du dashboard',
      activePeriod: 'Periode active',
      latestImport: 'Dernier import',
      syncedBase: 'Base RH synchronisee',
      items: {
        dashboard: { label: 'Tableau de bord', note: 'Vue globale RH' },
        pointage: { label: 'Pointage quotidien', note: 'Liste des presents' },
        employees: { label: 'Employes', note: 'Etat du personnel' },
        departments: { label: 'Departements', note: 'Repartition active' },
        reports: { label: 'Rapports', note: 'Synthese du fichier' },
        absences: { label: 'Absences & Conges', note: 'ABS, CM, conges' },
        settings: { label: 'Parametres', note: 'Import et base' },
      },
    },
    hero: {
      eyebrow: 'Pointage quotidien du personnel',
      title: 'TABLEAU DE BORD RH',
      subcopy:
        'Dashboard alimente par le fichier Excel de pointage. Clique sur un bouton a gauche ou sur une carte pour ouvrir une vraie liste de suivi RH.',
      importExcel: 'Importer Excel',
      importing: 'Import en cours...',
    },
    kpi: {
      workforceGlobal: 'Effectif globale',
      plant: 'Usine',
      presents: 'Presents',
      absents: 'Absents',
      late: 'Retards',
      recruitments: 'Nombre de recrutements',
      stcMonth: 'STC du mois',
      productionWorkforce: 'Effectif de production',
    },
    production: {
      focus: 'Focus departement',
      title: 'Production',
      employeesFollowed: (count) => `${count} employe(s) suivis`,
      productionTypes: 'Types de production',
      kindPresence: 'Presence MOD production',
      productionCategories: 'Categories production',
      serviceLabels: {
        injection: 'Injection',
        metallisation: 'Metallisation',
        serigraphie: 'Serigraphie',
        assemblage: 'Assemblage',
        autres: 'Autres',
      },
      total: 'Total',
      presents: 'Presents',
      presence: 'Presence',
      prefix: 'Production -',
    },
    charts: {
      departmentSplit: 'REPARTITION PAR DEPARTEMENT',
      noPresence: 'Aucune presence pour cette date.',
      total: 'Total',
      personnelStatus: 'STATUT DU PERSONNEL',
      clickToOpen: 'Clique pour ouvrir',
      presenceRate: 'TAUX DE PRESENCE',
      target: 'Objectif : 90%',
    },
    table: {
      pointageTitle: 'POINTAGE DU PERSONNEL',
      noActiveTable: 'Aucun tableau actif',
      search: 'Rechercher...',
      empty: 'Aucun employe a afficher. Importe un fichier Excel pour remplir le tableau.',
      standardHours: 'Heures standard',
      control: 'Controle',
      name: 'Nom',
      department: 'Departement',
      category: 'Categorie',
    },
    common: {
      to: 'au',
    },
    messages: {
      initialStatus: 'Charge le pointage depuis la base ou importe un fichier Excel.',
      dashboardReady: 'Dashboard RH pret.',
      analyzingFile: 'Analyse du fichier Excel en cours...',
      replacingBase: 'Remplacement de la base pointage en cours...',
      importDone: 'Fichier Excel importe.',
      importError: 'Import Excel impossible.',
    },
  },
  ar: {
    topbar: {
      language: 'اللغة',
      dateSelected: 'التاريخ المحدد',
      noDate: 'لا يوجد تاريخ',
      menu: 'القائمة',
      userRole: 'مدير الموارد البشرية',
      userCompany: 'MYC Beauty',
    },
    sidebar: {
      navigation: 'التنقل',
      aria: 'تنقل لوحة القيادة',
      activePeriod: 'الفترة النشطة',
      latestImport: 'آخر استيراد',
      syncedBase: 'قاعدة الموارد البشرية متزامنة',
      items: {
        dashboard: { label: 'لوحة القيادة', note: 'رؤية عامة للموارد البشرية' },
        pointage: { label: 'الحضور اليومي', note: 'قائمة الحاضرين' },
        employees: { label: 'الموظفون', note: 'حالة الموظفين' },
        departments: { label: 'الأقسام', note: 'التوزيع النشط' },
        reports: { label: 'التقارير', note: 'ملخص الملف' },
        absences: { label: 'الغيابات والإجازات', note: 'غياب ومرض وإجازات' },
        settings: { label: 'الإعدادات', note: 'الاستيراد والقاعدة' },
      },
    },
    hero: {
      eyebrow: 'متابعة حضور الموظفين اليومية',
      title: 'لوحة الموارد البشرية',
      subcopy:
        'هذه اللوحة تعتمد على ملف إكسل الخاص بالحضور. اضغط على زر في اليسار أو على أي بطاقة لفتح قائمة المتابعة.',
      importExcel: 'استيراد إكسل',
      importing: 'جارٍ الاستيراد...',
    },
    kpi: {
      workforceGlobal: 'إجمالي القوة العاملة',
      plant: 'المصنع',
      presents: 'الحاضرون',
      absents: 'الغائبون',
      late: 'المتأخرون',
      recruitments: 'عدد الانتدابات',
      stcMonth: 'مغادرة هذا الشهر',
      productionWorkforce: 'عدد عمال الإنتاج',
    },
    production: {
      focus: 'تركيز القسم',
      title: 'الإنتاج',
      employeesFollowed: (count) => `${count} موظف(ة) متابع`,
      productionTypes: 'أنواع الإنتاج',
      kindPresence: 'نسبة حضور MOD في الإنتاج',
      productionCategories: 'فئات الإنتاج',
      serviceLabels: {
        injection: 'الحقن',
        metallisation: 'المعدنة',
        serigraphie: 'الطباعة',
        assemblage: 'التركيب',
        autres: 'أخرى',
      },
      total: 'الإجمالي',
      presents: 'الحاضرون',
      presence: 'نسبة الحضور',
      prefix: 'إنتاج -',
    },
    charts: {
      departmentSplit: 'توزيع حسب القسم',
      noPresence: 'لا توجد أي حالة حضور لهذا التاريخ.',
      total: 'الإجمالي',
      personnelStatus: 'حالة الموظفين',
      clickToOpen: 'اضغط للفتح',
      presenceRate: 'نسبة الحضور',
      target: 'الهدف: 90%',
    },
    table: {
      pointageTitle: 'كشف الحضور',
      noActiveTable: 'لا يوجد جدول نشط',
      search: 'بحث...',
      empty: 'لا يوجد موظفون للعرض. قم باستيراد ملف إكسل لملء الجدول.',
      standardHours: 'الساعات القياسية',
      control: 'مراقبة',
      name: 'الاسم',
      department: 'القسم',
      category: 'الفئة',
    },
    common: {
      to: 'إلى',
    },
    messages: {
      initialStatus: 'قم بتحميل الحضور من القاعدة أو استورد ملف إكسل.',
      dashboardReady: 'لوحة الموارد البشرية جاهزة.',
      analyzingFile: 'جارٍ تحليل ملف إكسل...',
      replacingBase: 'جارٍ استبدال قاعدة الحضور...',
      importDone: 'تم استيراد ملف إكسل.',
      importError: 'تعذر استيراد ملف إكسل.',
    },
  },
  en: {
    topbar: {
      language: 'Language',
      dateSelected: 'Selected date',
      noDate: 'No date',
      menu: 'Menu',
      userRole: 'HR Manager',
      userCompany: 'MYC Beauty',
    },
    sidebar: {
      navigation: 'Navigation',
      aria: 'Dashboard navigation',
      activePeriod: 'Active period',
      latestImport: 'Latest import',
      syncedBase: 'HR base synchronized',
      items: {
        dashboard: { label: 'Dashboard', note: 'Global HR view' },
        pointage: { label: 'Daily attendance', note: 'Present employees list' },
        employees: { label: 'Employees', note: 'Staff status' },
        departments: { label: 'Departments', note: 'Active distribution' },
        reports: { label: 'Reports', note: 'File summary' },
        absences: { label: 'Absences & leave', note: 'ABS, sick leave, leave' },
        settings: { label: 'Settings', note: 'Import and base' },
      },
    },
    hero: {
      eyebrow: 'Daily staff attendance',
      title: 'HR DASHBOARD',
      subcopy:
        'This dashboard is powered by the attendance Excel file. Click a button on the left or a card to open a real HR follow-up list.',
      importExcel: 'Import Excel',
      importing: 'Importing...',
    },
    kpi: {
      workforceGlobal: 'Global workforce',
      plant: 'Factory',
      presents: 'Present',
      absents: 'Absent',
      late: 'Late arrivals',
      recruitments: 'Recruitments',
      stcMonth: 'Monthly STC',
      productionWorkforce: 'Production workforce',
    },
    production: {
      focus: 'Department focus',
      title: 'Production',
      employeesFollowed: (count) => `${count} employee(s) tracked`,
      productionTypes: 'Production types',
      kindPresence: 'Production MOD presence',
      productionCategories: 'Production categories',
      serviceLabels: {
        injection: 'Injection',
        metallisation: 'Metallization',
        serigraphie: 'Screen printing',
        assemblage: 'Assembly',
        autres: 'Others',
      },
      total: 'Total',
      presents: 'Present',
      presence: 'Presence',
      prefix: 'Production -',
    },
    charts: {
      departmentSplit: 'DEPARTMENT DISTRIBUTION',
      noPresence: 'No attendance for this date.',
      total: 'Total',
      personnelStatus: 'STAFF STATUS',
      clickToOpen: 'Click to open',
      presenceRate: 'ATTENDANCE RATE',
      target: 'Target: 90%',
    },
    table: {
      pointageTitle: 'ATTENDANCE TABLE',
      noActiveTable: 'No active table',
      search: 'Search...',
      empty: 'No employees to display. Import an Excel file to fill the table.',
      standardHours: 'Standard hours',
      control: 'Control',
      name: 'Name',
      department: 'Department',
      category: 'Category',
    },
    common: {
      to: 'to',
    },
    messages: {
      initialStatus: 'Load attendance from the base or import an Excel file.',
      dashboardReady: 'HR dashboard ready.',
      analyzingFile: 'Analyzing the Excel file...',
      replacingBase: 'Replacing the attendance base...',
      importDone: 'Excel file imported.',
      importError: 'Excel import failed.',
    },
  },
  it: {
    topbar: {
      language: 'Lingua',
      dateSelected: 'Data selezionata',
      noDate: 'Nessuna data',
      menu: 'Menu',
      userRole: 'Responsabile HR',
      userCompany: 'MYC Beauty',
    },
    sidebar: {
      navigation: 'Navigazione',
      aria: 'Navigazione dashboard',
      activePeriod: 'Periodo attivo',
      latestImport: 'Ultima importazione',
      syncedBase: 'Base HR sincronizzata',
      items: {
        dashboard: { label: 'Dashboard', note: 'Vista globale HR' },
        pointage: { label: 'Presenze giornaliere', note: 'Elenco presenti' },
        employees: { label: 'Dipendenti', note: 'Stato del personale' },
        departments: { label: 'Reparti', note: 'Ripartizione attiva' },
        reports: { label: 'Report', note: 'Sintesi del file' },
        absences: { label: 'Assenze e congedi', note: 'ABS, malattia, congedi' },
        settings: { label: 'Impostazioni', note: 'Import e base' },
      },
    },
    hero: {
      eyebrow: 'Presenze quotidiane del personale',
      title: 'DASHBOARD HR',
      subcopy:
        'Questa dashboard usa il file Excel delle presenze. Clicca un pulsante a sinistra o una scheda per aprire una vera lista di monitoraggio HR.',
      importExcel: 'Importa Excel',
      importing: 'Importazione...',
    },
    kpi: {
      workforceGlobal: 'Organico globale',
      plant: 'Stabilimento',
      presents: 'Presenti',
      absents: 'Assenti',
      late: 'Ritardi',
      recruitments: 'Numero assunzioni',
      stcMonth: 'STC del mese',
      productionWorkforce: 'Organico produzione',
    },
    production: {
      focus: 'Focus reparto',
      title: 'Produzione',
      employeesFollowed: (count) => `${count} dipendente(i) monitorati`,
      productionTypes: 'Tipi di produzione',
      kindPresence: 'Presenza MOD produzione',
      productionCategories: 'Categorie produzione',
      serviceLabels: {
        injection: 'Iniezione',
        metallisation: 'Metallizzazione',
        serigraphie: 'Serigrafia',
        assemblage: 'Assemblaggio',
        autres: 'Altri',
      },
      total: 'Totale',
      presents: 'Presenti',
      presence: 'Presenza',
      prefix: 'Produzione -',
    },
    charts: {
      departmentSplit: 'RIPARTIZIONE PER REPARTO',
      noPresence: 'Nessuna presenza per questa data.',
      total: 'Totale',
      personnelStatus: 'STATO DEL PERSONALE',
      clickToOpen: 'Clicca per aprire',
      presenceRate: 'TASSO DI PRESENZA',
      target: 'Obiettivo: 90%',
    },
    table: {
      pointageTitle: 'TABELLA PRESENZE',
      noActiveTable: 'Nessuna tabella attiva',
      search: 'Cerca...',
      empty: 'Nessun dipendente da mostrare. Importa un file Excel per compilare la tabella.',
      standardHours: 'Ore standard',
      control: 'Controllo',
      name: 'Nome',
      department: 'Reparto',
      category: 'Categoria',
    },
    common: {
      to: 'a',
    },
    messages: {
      initialStatus: 'Carica le presenze dalla base o importa un file Excel.',
      dashboardReady: 'Dashboard HR pronta.',
      analyzingFile: 'Analisi del file Excel...',
      replacingBase: 'Sostituzione base presenze...',
      importDone: 'File Excel importato.',
      importError: 'Importazione Excel non riuscita.',
    },
  },
  zh: {
    topbar: {
      language: '语言',
      dateSelected: '已选日期',
      noDate: '无日期',
      menu: '菜单',
      userRole: '人力资源经理',
      userCompany: 'MYC Beauty',
    },
    sidebar: {
      navigation: '导航',
      aria: '仪表板导航',
      activePeriod: '当前周期',
      latestImport: '最近导入',
      syncedBase: '人事库已同步',
      items: {
        dashboard: { label: '仪表板', note: '人力资源总览' },
        pointage: { label: '每日考勤', note: '出勤人员列表' },
        employees: { label: '员工', note: '员工状态' },
        departments: { label: '部门', note: '在岗分布' },
        reports: { label: '报表', note: '文件摘要' },
        absences: { label: '缺勤与休假', note: '缺勤、病假、休假' },
        settings: { label: '设置', note: '导入与基础库' },
      },
    },
    hero: {
      eyebrow: '员工每日考勤',
      title: '人力资源仪表板',
      subcopy: '该仪表板基于考勤 Excel 文件。点击左侧按钮或卡片即可打开真实的人事跟踪列表。',
      importExcel: '导入 Excel',
      importing: '导入中...',
    },
    kpi: {
      workforceGlobal: '全厂人数',
      plant: '工厂',
      presents: '出勤',
      absents: '缺勤',
      late: '迟到',
      recruitments: '招聘人数',
      stcMonth: '本月 STC',
      productionWorkforce: '生产人数',
    },
    production: {
      focus: '部门焦点',
      title: '生产',
      employeesFollowed: (count) => `跟踪员工 ${count} 人`,
      productionTypes: '生产类型',
      kindPresence: '生产 MOD 出勤率',
      productionCategories: '生产类别',
      serviceLabels: {
        injection: '注塑',
        metallisation: '金属化',
        serigraphie: '丝印',
        assemblage: '装配',
        autres: '其他',
      },
      total: '总数',
      presents: '出勤',
      presence: '出勤率',
      prefix: '生产 -',
    },
    charts: {
      departmentSplit: '部门分布',
      noPresence: '该日期没有出勤数据。',
      total: '总数',
      personnelStatus: '员工状态',
      clickToOpen: '点击打开',
      presenceRate: '出勤率',
      target: '目标：90%',
    },
    table: {
      pointageTitle: '考勤表',
      noActiveTable: '无活动表',
      search: '搜索...',
      empty: '没有可显示的员工。请导入 Excel 文件填充表格。',
      standardHours: '标准工时',
      control: '核对',
      name: '姓名',
      department: '部门',
      category: '类别',
    },
    common: {
      to: '至',
    },
    messages: {
      initialStatus: '请从基础库加载考勤或导入 Excel 文件。',
      dashboardReady: '人力资源仪表板已就绪。',
      analyzingFile: '正在分析 Excel 文件...',
      replacingBase: '正在替换考勤基础库...',
      importDone: 'Excel 文件已导入。',
      importError: 'Excel 导入失败。',
    },
  },
};

const UI_EXT_TRANSLATIONS = {
  fr: {
    switcher: {
      title: 'Traduction',
    },
    modal: {
      eyebrow: 'Detail KPI',
      close: 'Fermer',
      people: (count) => `${count} personnes`,
      search: 'Rechercher une personne...',
      noResults: 'Aucun resultat pour cette recherche.',
      columns: { id: 'ID', name: 'Nom', department: 'Departement', category: 'Categorie', status: 'Statut', detail: 'Detail' },
    },
    employeeEditor: {
      eyebrow: 'Base RH',
      addTitle: 'Ajouter un employe',
      editTitle: 'Modifier la fiche employe',
      addDescription: 'Complete la fiche puis sauvegarde pour l enregistrer dans la base.',
      editDescription: 'Modifie les informations de la fiche puis sauvegarde les changements.',
      close: 'Fermer',
      add: 'Ajouter',
      save: 'Enregistrer',
      saving: 'Sauvegarde...',
      choose: 'Choisir...',
      deleteTitle: 'Supprimer cette fiche',
      deleteHint: 'Entre `123` ou `MYC` pour autoriser la suppression de cet utilisateur.',
      deletePlaceholder: 'Code 123 ou MYC',
      deleting: 'Suppression...',
      delete: 'Supprimer',
    },
    employeeBase: {
      eyebrow: 'Base RH enregistree',
      title: 'Gestion des employes',
      description: 'Ajoute, modifie ou supprime un utilisateur directement depuis la base RH sauvegardee.',
      export: 'Exporter Excel',
      add: 'Ajouter un employe',
      cards: { records: 'Fiches RH', active: 'Actifs', stc: 'STC' },
      baseTitle: 'Base du personnel',
      baseSubtitle: (count) => `${count} departement(s) relies a cette base.`,
      search: 'Rechercher un employe, service, code...',
      visible: (count) => `${count} fiche(s) visibles`,
      summary: (count) => `${count} departement(s) dans la base RH. Clique sur Modifier pour ouvrir la fiche.`,
      columns: { code: 'Code', name: 'Nom', department: 'Departement', service: 'Service', category: 'Categorie', contract: 'Contrat', status: 'Statut', action: 'Action' },
      edit: 'Modifier',
      empty: 'Aucun employe trouve pour cette recherche.',
    },
    departmentBase: {
      eyebrow: 'Base RH enregistree',
      search: 'Rechercher un departement...',
      metrics: { departments: 'Departements', services: 'Services', active: 'Actifs', stc: 'STC' },
      columns: { department: 'Departement', totalBase: 'Total base', active: 'Actifs', stc: 'STC', services: 'Services', activeRate: 'Taux actif' },
      empty: 'Aucun departement trouve pour cette recherche.',
    },
    absences: {
      eyebrow: 'Suivi des absences',
      title: 'ABSENCES & CONGES',
      subtitle: (date) => `${date} | Detail des ABS, CM, conges et repos du jour.`,
      search: 'Rechercher une absence ou un conge...',
      none: 'Aucune absence',
      empty: 'Aucune absence ou aucun conge trouve pour cette recherche.',
      columns: { type: 'Type', detail: 'Detail' },
    },
    section: {
      noWeek: 'Aucune semaine',
      noPeriod: 'Aucune periode disponible',
    },
    status: {
      noData: 'Aucune donnee',
      present: 'Present',
      verify: 'A verifier',
      absent: 'Absent',
      late: 'Retard',
      sickLeave: 'Conge maladie',
      leave: 'Conge',
      rest: 'Repos',
      stc: 'STC',
      notStarted: 'Non demarre',
      active: 'Actif',
      suspended: 'Suspendu',
      newHire: 'Nouveau',
    },
    employeeFields: {
      finalCode: 'Code final',
      id: 'Matricule',
      fullName: 'Nom complet',
      department: 'Departement',
      service: 'Service',
      kind: 'Categorie',
      contract: 'Contrat',
      status: 'Statut',
      payType: 'Type de paie',
      signed: 'Contrat signe',
      hiredAt: 'Date embauche',
      job: 'Poste',
      inactiveFrom: 'Inactif depuis',
    },
  },
  en: {
    switcher: { title: 'Translation' },
    modal: {
      eyebrow: 'KPI details',
      close: 'Close',
      people: (count) => `${count} people`,
      search: 'Search a person...',
      noResults: 'No result for this search.',
      columns: { id: 'ID', name: 'Name', department: 'Department', category: 'Category', status: 'Status', detail: 'Detail' },
    },
    employeeEditor: {
      eyebrow: 'HR base',
      addTitle: 'Add employee',
      editTitle: 'Edit employee record',
      addDescription: 'Complete the form, then save it to the HR base.',
      editDescription: 'Update the employee record, then save your changes.',
      close: 'Close',
      add: 'Add',
      save: 'Save',
      saving: 'Saving...',
      choose: 'Choose...',
      deleteTitle: 'Delete this record',
      deleteHint: 'Enter `123` or `MYC` to allow deleting this user.',
      deletePlaceholder: 'Code 123 or MYC',
      deleting: 'Deleting...',
      delete: 'Delete',
    },
    employeeBase: {
      eyebrow: 'Saved HR base',
      title: 'Employee management',
      description: 'Add, edit or delete a user directly from the saved HR base.',
      export: 'Export Excel',
      add: 'Add employee',
      cards: { records: 'HR records', active: 'Active', stc: 'STC' },
      baseTitle: 'Staff base',
      baseSubtitle: (count) => `${count} department(s) linked to this base.`,
      search: 'Search employee, service, code...',
      visible: (count) => `${count} visible record(s)`,
      summary: (count) => `${count} department(s) in the HR base. Click Edit to open the record.`,
      columns: { code: 'Code', name: 'Name', department: 'Department', service: 'Service', category: 'Category', contract: 'Contract', status: 'Status', action: 'Action' },
      edit: 'Edit',
      empty: 'No employee found for this search.',
    },
    departmentBase: {
      eyebrow: 'Saved HR base',
      search: 'Search a department...',
      metrics: { departments: 'Departments', services: 'Services', active: 'Active', stc: 'STC' },
      columns: { department: 'Department', totalBase: 'Total base', active: 'Active', stc: 'STC', services: 'Services', activeRate: 'Active rate' },
      empty: 'No department found for this search.',
    },
    absences: {
      eyebrow: 'Absence monitoring',
      title: 'ABSENCES & LEAVE',
      subtitle: (date) => `${date} | Details of ABS, sick leave, leave and rest for the day.`,
      search: 'Search an absence or leave...',
      none: 'No absence',
      empty: 'No absence or leave found for this search.',
      columns: { type: 'Type', detail: 'Detail' },
    },
    section: { noWeek: 'No week', noPeriod: 'No period available' },
    status: { noData: 'No data', present: 'Present', verify: 'To verify', absent: 'Absent', late: 'Late', sickLeave: 'Sick leave', leave: 'Leave', rest: 'Rest', stc: 'STC', notStarted: 'Not started', active: 'Active', suspended: 'Suspended', newHire: 'New hire' },
    employeeFields: {
      finalCode: 'Final code', id: 'Employee ID', fullName: 'Full name', department: 'Department', service: 'Service', kind: 'Category', contract: 'Contract', status: 'Status', payType: 'Pay type', signed: 'Signed contract', hiredAt: 'Hire date', job: 'Job title', inactiveFrom: 'Inactive since',
    },
  },
  ar: {
    switcher: { title: 'الترجمة' },
    modal: {
      eyebrow: 'تفاصيل المؤشر',
      close: 'إغلاق',
      people: (count) => `${count} أشخاص`,
      search: 'ابحث عن شخص...',
      noResults: 'لا توجد نتائج لهذا البحث.',
      columns: { id: 'المعرف', name: 'الاسم', department: 'القسم', category: 'الفئة', status: 'الحالة', detail: 'التفصيل' },
    },
    employeeEditor: {
      eyebrow: 'قاعدة الموارد البشرية',
      addTitle: 'إضافة موظف',
      editTitle: 'تعديل ملف الموظف',
      addDescription: 'أكمل البطاقة ثم احفظها لتسجيلها في القاعدة.',
      editDescription: 'عدّل معلومات البطاقة ثم احفظ التغييرات.',
      close: 'إغلاق',
      add: 'إضافة',
      save: 'حفظ',
      saving: 'جارٍ الحفظ...',
      choose: 'اختر...',
      deleteTitle: 'حذف هذه البطاقة',
      deleteHint: 'أدخل `123` أو `MYC` للسماح بحذف هذا المستخدم.',
      deletePlaceholder: 'الرمز 123 أو MYC',
      deleting: 'جارٍ الحذف...',
      delete: 'حذف',
    },
    employeeBase: {
      eyebrow: 'قاعدة الموارد البشرية المحفوظة',
      title: 'إدارة الموظفين',
      description: 'أضف أو عدّل أو احذف مستخدمًا مباشرة من قاعدة الموارد البشرية المحفوظة.',
      export: 'تصدير Excel',
      add: 'إضافة موظف',
      cards: { records: 'ملفات الموارد البشرية', active: 'نشطون', stc: 'STC' },
      baseTitle: 'قاعدة الموظفين',
      baseSubtitle: (count) => `${count} قسمًا مرتبطًا بهذه القاعدة.`,
      search: 'ابحث عن موظف أو خدمة أو رمز...',
      visible: (count) => `${count} بطاقة ظاهرة`,
      summary: (count) => `${count} قسمًا داخل قاعدة الموارد البشرية. اضغط تعديل لفتح البطاقة.`,
      columns: { code: 'الرمز', name: 'الاسم', department: 'القسم', service: 'الخدمة', category: 'الفئة', contract: 'العقد', status: 'الحالة', action: 'الإجراء' },
      edit: 'تعديل',
      empty: 'لم يتم العثور على موظف لهذا البحث.',
    },
    departmentBase: {
      eyebrow: 'قاعدة الموارد البشرية المحفوظة',
      search: 'ابحث عن قسم...',
      metrics: { departments: 'الأقسام', services: 'الخدمات', active: 'نشطون', stc: 'STC' },
      columns: { department: 'القسم', totalBase: 'إجمالي القاعدة', active: 'نشطون', stc: 'STC', services: 'الخدمات', activeRate: 'نسبة النشاط' },
      empty: 'لم يتم العثور على قسم لهذا البحث.',
    },
    absences: {
      eyebrow: 'متابعة الغيابات',
      title: 'الغيابات والإجازات',
      subtitle: (date) => `${date} | تفاصيل الغياب والمرض والإجازة والراحة لهذا اليوم.`,
      search: 'ابحث عن غياب أو إجازة...',
      none: 'لا توجد غيابات',
      empty: 'لم يتم العثور على غياب أو إجازة لهذا البحث.',
      columns: { type: 'النوع', detail: 'التفصيل' },
    },
    section: { noWeek: 'لا يوجد أسبوع', noPeriod: 'لا توجد فترة متاحة' },
    status: { noData: 'لا توجد بيانات', present: 'حاضر', verify: 'للمراجعة', absent: 'غائب', late: 'متأخر', sickLeave: 'إجازة مرضية', leave: 'إجازة', rest: 'راحة', stc: 'STC', notStarted: 'لم يبدأ', active: 'نشط', suspended: 'معلّق', newHire: 'منتدب جديد' },
    employeeFields: {
      finalCode: 'الرمز النهائي', id: 'المعرف الوظيفي', fullName: 'الاسم الكامل', department: 'القسم', service: 'الخدمة', kind: 'الفئة', contract: 'العقد', status: 'الحالة', payType: 'نوع الأجر', signed: 'العقد ممضى', hiredAt: 'تاريخ الانتداب', job: 'المنصب', inactiveFrom: 'غير نشط منذ',
    },
  },
  it: {
    switcher: { title: 'Traduzione' },
    modal: {
      eyebrow: 'Dettaglio KPI',
      close: 'Chiudi',
      people: (count) => `${count} persone`,
      search: 'Cerca una persona...',
      noResults: 'Nessun risultato per questa ricerca.',
      columns: { id: 'ID', name: 'Nome', department: 'Reparto', category: 'Categoria', status: 'Stato', detail: 'Dettaglio' },
    },
    employeeEditor: {
      eyebrow: 'Base HR',
      addTitle: 'Aggiungi dipendente',
      editTitle: 'Modifica scheda dipendente',
      addDescription: 'Compila la scheda e salvala nella base HR.',
      editDescription: 'Modifica le informazioni della scheda e salva i cambiamenti.',
      close: 'Chiudi',
      add: 'Aggiungi',
      save: 'Salva',
      saving: 'Salvataggio...',
      choose: 'Scegli...',
      deleteTitle: 'Elimina questa scheda',
      deleteHint: 'Inserisci `123` o `MYC` per autorizzare l eliminazione di questo utente.',
      deletePlaceholder: 'Codice 123 o MYC',
      deleting: 'Eliminazione...',
      delete: 'Elimina',
    },
    employeeBase: {
      eyebrow: 'Base HR salvata',
      title: 'Gestione dipendenti',
      description: 'Aggiungi, modifica o elimina un utente direttamente dalla base HR salvata.',
      export: 'Esporta Excel',
      add: 'Aggiungi dipendente',
      cards: { records: 'Schede HR', active: 'Attivi', stc: 'STC' },
      baseTitle: 'Base del personale',
      baseSubtitle: (count) => `${count} reparto/i collegati a questa base.`,
      search: 'Cerca dipendente, servizio, codice...',
      visible: (count) => `${count} scheda/e visibili`,
      summary: (count) => `${count} reparto/i nella base HR. Clicca Modifica per aprire la scheda.`,
      columns: { code: 'Codice', name: 'Nome', department: 'Reparto', service: 'Servizio', category: 'Categoria', contract: 'Contratto', status: 'Stato', action: 'Azione' },
      edit: 'Modifica',
      empty: 'Nessun dipendente trovato per questa ricerca.',
    },
    departmentBase: {
      eyebrow: 'Base HR salvata',
      search: 'Cerca un reparto...',
      metrics: { departments: 'Reparti', services: 'Servizi', active: 'Attivi', stc: 'STC' },
      columns: { department: 'Reparto', totalBase: 'Totale base', active: 'Attivi', stc: 'STC', services: 'Servizi', activeRate: 'Tasso attivo' },
      empty: 'Nessun reparto trovato per questa ricerca.',
    },
    absences: {
      eyebrow: 'Monitoraggio assenze',
      title: 'ASSENZE E CONGEDI',
      subtitle: (date) => `${date} | Dettaglio di ABS, malattia, congedi e riposo del giorno.`,
      search: 'Cerca un assenza o un congedo...',
      none: 'Nessuna assenza',
      empty: 'Nessuna assenza o congedo trovato per questa ricerca.',
      columns: { type: 'Tipo', detail: 'Dettaglio' },
    },
    section: { noWeek: 'Nessuna settimana', noPeriod: 'Nessun periodo disponibile' },
    status: { noData: 'Nessun dato', present: 'Presente', verify: 'Da verificare', absent: 'Assente', late: 'Ritardo', sickLeave: 'Malattia', leave: 'Congedo', rest: 'Riposo', stc: 'STC', notStarted: 'Non iniziato', active: 'Attivo', suspended: 'Sospeso', newHire: 'Nuovo assunto' },
    employeeFields: {
      finalCode: 'Codice finale', id: 'Matricola', fullName: 'Nome completo', department: 'Reparto', service: 'Servizio', kind: 'Categoria', contract: 'Contratto', status: 'Stato', payType: 'Tipo paga', signed: 'Contratto firmato', hiredAt: 'Data assunzione', job: 'Ruolo', inactiveFrom: 'Inattivo dal',
    },
  },
  zh: {
    switcher: { title: '翻译' },
    modal: {
      eyebrow: '指标详情',
      close: '关闭',
      people: (count) => `${count} 人`,
      search: '搜索人员...',
      noResults: '此搜索没有结果。',
      columns: { id: '编号', name: '姓名', department: '部门', category: '类别', status: '状态', detail: '详情' },
    },
    employeeEditor: {
      eyebrow: '人事基础库',
      addTitle: '添加员工',
      editTitle: '编辑员工档案',
      addDescription: '填写表单后保存到人事基础库。',
      editDescription: '修改员工信息后保存更改。',
      close: '关闭',
      add: '添加',
      save: '保存',
      saving: '保存中...',
      choose: '请选择...',
      deleteTitle: '删除此档案',
      deleteHint: '输入 `123` 或 `MYC` 以允许删除该用户。',
      deletePlaceholder: '代码 123 或 MYC',
      deleting: '删除中...',
      delete: '删除',
    },
    employeeBase: {
      eyebrow: '已保存的人事库',
      title: '员工管理',
      description: '直接从已保存的人事库中添加、修改或删除用户。',
      export: '导出 Excel',
      add: '添加员工',
      cards: { records: '人事档案', active: '在职', stc: 'STC' },
      baseTitle: '员工基础库',
      baseSubtitle: (count) => `此基础库关联 ${count} 个部门。`,
      search: '搜索员工、服务或代码...',
      visible: (count) => `${count} 条可见记录`,
      summary: (count) => `人事库中有 ${count} 个部门。点击编辑打开档案。`,
      columns: { code: '代码', name: '姓名', department: '部门', service: '服务', category: '类别', contract: '合同', status: '状态', action: '操作' },
      edit: '编辑',
      empty: '未找到符合搜索的员工。',
    },
    departmentBase: {
      eyebrow: '已保存的人事库',
      search: '搜索部门...',
      metrics: { departments: '部门', services: '服务', active: '在职', stc: 'STC' },
      columns: { department: '部门', totalBase: '总人数', active: '在职', stc: 'STC', services: '服务', activeRate: '在职率' },
      empty: '未找到符合搜索的部门。',
    },
    absences: {
      eyebrow: '缺勤跟踪',
      title: '缺勤与休假',
      subtitle: (date) => `${date} | 当日缺勤、病假、休假和休息详情。`,
      search: '搜索缺勤或休假...',
      none: '没有缺勤',
      empty: '未找到符合搜索的缺勤或休假。',
      columns: { type: '类型', detail: '详情' },
    },
    section: { noWeek: '无周次', noPeriod: '无可用周期' },
    status: { noData: '无数据', present: '出勤', verify: '待核查', absent: '缺勤', late: '迟到', sickLeave: '病假', leave: '休假', rest: '休息', stc: 'STC', notStarted: '未开始', active: '在职', suspended: '暂停', newHire: '新入职' },
    employeeFields: {
      finalCode: '最终代码', id: '工号', fullName: '姓名', department: '部门', service: '服务', kind: '类别', contract: '合同', status: '状态', payType: '薪资类型', signed: '合同已签', hiredAt: '入职日期', job: '岗位', inactiveFrom: '停用日期',
    },
  },
};

const SIDEBAR_ITEMS = [
  {
    key: 'dashboard',
    label: 'Tableau de bord',
    note: 'Vue globale RH',
  },
  {
    key: 'pointage',
    label: 'Pointage quotidien',
    note: 'Liste des presents',
  },
  {
    key: 'employees',
    label: 'Employes',
    note: 'Etat du personnel',
  },
  {
    key: 'departments',
    label: 'Departements',
    note: 'Repartition active',
  },
  {
    key: 'reports',
    label: 'Rapports',
    note: 'Synthese du fichier',
  },
  {
    key: 'absences',
    label: 'Absences & Conges',
    note: 'ABS, CM, conges',
  },
  {
    key: 'settings',
    label: 'Parametres',
    note: 'Import et base',
  },
];

const EMPLOYEE_FORM_FIELDS = [
  { key: 'finalCode', label: 'Code final' },
  { key: 'id', label: 'Matricule' },
  { key: 'fullName', label: 'Nom complet' },
  { key: 'department', label: 'Departement' },
  { key: 'service', label: 'Service' },
  { key: 'kind', label: 'Categorie' },
  { key: 'contract', label: 'Contrat' },
  { key: 'status', label: 'Statut' },
  { key: 'payType', label: 'Type de paie' },
  { key: 'signed', label: 'Contrat signe' },
  { key: 'hiredAt', label: 'Date embauche' },
  { key: 'job', label: 'Poste' },
  { key: 'inactiveFrom', label: 'Inactif depuis' },
];

function formatDateLabel(isoDate, locale = 'fr-FR') {
  if (!isoDate) return '--';

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function parseLooseDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const frMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (frMatch) {
    const day = Number(frMatch[1]);
    const month = Number(frMatch[2]) - 1;
    const year = Number(frMatch[3]);
    const parsed = new Date(year, month, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function getMonthKey(value) {
  const date = parseLooseDate(value);
  if (!date) return '';

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(value, locale = 'fr-FR') {
  const date = parseLooseDate(value);
  if (!date) return '--';

  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatPeriodLabel(startDate, endDate, locale = 'fr-FR', separator = 'au') {
  if (!startDate && !endDate) {
    return '--';
  }

  if (!startDate || !endDate || startDate === endDate) {
    return formatShortDateLabel(startDate || endDate, locale);
  }

  return `${formatShortDateLabel(startDate, locale)} ${separator} ${formatShortDateLabel(endDate, locale)}`;
}

function normalizeLookupText(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function isFutureMarkerDay(day) {
  const raw = normalizeLookupText(day?.raw ?? day?.display ?? '');
  return raw === 'X';
}

function getWeeklyCellToken(day) {
  const rawToken = normalizeLookupText(day?.raw ?? day?.display ?? '');
  const statusToken = normalizeLookupText(day?.status ?? '');

  if (rawToken) {
    return rawToken;
  }

  return statusToken;
}

function hasStartedWorkInPeriod(days) {
  return days.some((day) => {
    const token = getWeeklyCellToken(day);
    return Boolean(token) && token !== 'X' && token !== 'EMPTY';
  });
}

function hasWeeklyStc(days) {
  return days.some((day) => getWeeklyCellToken(day) === 'STC');
}

function getFirstStcDateInPeriod(days) {
  const firstStcDay = days.find((day) => getWeeklyCellToken(day) === 'STC');
  if (!firstStcDay) {
    return '';
  }

  if (firstStcDay.isoDate) {
    return formatShortDateLabel(firstStcDay.isoDate);
  }

  return String(firstStcDay.label || 'STC').trim();
}

function getFirstActiveDateInPeriod(days) {
  const firstActiveDay = days.find((day) => {
    const token = getWeeklyCellToken(day);
    return Boolean(token) && token !== 'X' && token !== 'EMPTY';
  });

  return firstActiveDay?.isoDate || '';
}

function buildEmployeeLookup(employees) {
  const byCode = new Map();
  const byName = new Map();

  employees.forEach((employee) => {
    [employee.id, employee.finalCode, employee.zk, employee.saber].forEach((code) => {
      const normalizedCode = normalizeLookupText(code);
      if (normalizedCode && !byCode.has(normalizedCode)) {
        byCode.set(normalizedCode, employee);
      }
    });

    const normalizedName = normalizeLookupText(employee.fullName);
    if (normalizedName && !byName.has(normalizedName)) {
      byName.set(normalizedName, employee);
    }
  });

  return function findEmployeeMatch(row) {
    const codeCandidates = [row?.id, row?.employeeKey];

    for (const candidate of codeCandidates) {
      const normalizedCode = normalizeLookupText(candidate);
      if (normalizedCode && byCode.has(normalizedCode)) {
        return byCode.get(normalizedCode);
      }
    }

    const normalizedName = normalizeLookupText(row?.fullName);
    if (normalizedName && byName.has(normalizedName)) {
      return byName.get(normalizedName);
    }

    return null;
  };
}

function buildPeriodEmployees(snapshot, periodStart, periodEnd, employees) {
  if (!periodStart || !periodEnd || !Array.isArray(snapshot?.weeklySheets)) {
    return [];
  }

  const findEmployeeMatch = buildEmployeeLookup(employees);
  const periodEmployees = new Map();

  snapshot.weeklySheets.forEach((sheet) => {
    const dayIndexes = (sheet.dayColumns || [])
      .map((day, index) => ({ ...day, index }))
      .filter((day) => day.isoDate && day.isoDate >= periodStart && day.isoDate <= periodEnd);

    if (!dayIndexes.length) {
      return;
    }

    (sheet.rows || []).forEach((row, rowIndex) => {
      const periodDays = dayIndexes.map((day) => row.days?.[day.index]).filter(Boolean);

      if (!periodDays.length || !hasStartedWorkInPeriod(periodDays)) {
        return;
      }

      const matchedEmployee = findEmployeeMatch(row);
      const uniqueKey =
        row.employeeKey ||
        row.id ||
        normalizeLookupText(row.fullName) ||
        `${sheet.sheetName || 'period'}-${rowIndex}`;

      if (periodEmployees.has(uniqueKey)) {
        return;
      }

      const isPeriodStc = hasWeeklyStc(periodDays);
      const firstStcDate = isPeriodStc ? getFirstStcDateInPeriod(periodDays) : '';

      periodEmployees.set(uniqueKey, {
        employeeKey: uniqueKey,
        id: row.id || matchedEmployee?.finalCode || matchedEmployee?.id || matchedEmployee?.zk || '-',
        fullName: row.fullName || matchedEmployee?.fullName || '-',
        department: matchedEmployee?.department || row.department || '-',
        kind: matchedEmployee?.kind || row.kind || '-',
        status: isPeriodStc ? 'STC' : matchedEmployee?.status || 'Actif',
        detail: isPeriodStc ? firstStcDate || 'STC' : matchedEmployee?.contract || row.control || '-',
      });
    });
  });

  return [...periodEmployees.values()].sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function buildFirstStcDateMap(snapshot, periodStart, periodEnd) {
  if (!periodStart || !periodEnd || !Array.isArray(snapshot?.weeklySheets)) {
    return new Map();
  }

  const stcMap = new Map();

  snapshot.weeklySheets.forEach((sheet) => {
    const dayIndexes = (sheet.dayColumns || [])
      .map((day, index) => ({ ...day, index }))
      .filter((day) => day.isoDate && day.isoDate >= periodStart && day.isoDate <= periodEnd);

    if (!dayIndexes.length) {
      return;
    }

    (sheet.rows || []).forEach((row, rowIndex) => {
      const uniqueKey =
        row.employeeKey ||
        row.id ||
        normalizeLookupText(row.fullName) ||
        `${sheet.sheetName || 'period'}-${rowIndex}`;

      dayIndexes.forEach((day) => {
        const cell = row.days?.[day.index];
        if (getWeeklyCellToken(cell) !== 'STC') {
          return;
        }

        const currentValue = stcMap.get(uniqueKey);
        if (!currentValue || day.isoDate < currentValue) {
          stcMap.set(uniqueKey, day.isoDate);
        }
      });
    });
  });

  return stcMap;
}

function buildFirstActiveDateMap(snapshot, periodStart, periodEnd) {
  if (!periodStart || !periodEnd || !Array.isArray(snapshot?.weeklySheets)) {
    return new Map();
  }

  const activeMap = new Map();

  snapshot.weeklySheets.forEach((sheet) => {
    const dayIndexes = (sheet.dayColumns || [])
      .map((day, index) => ({ ...day, index }))
      .filter((day) => day.isoDate && day.isoDate >= periodStart && day.isoDate <= periodEnd);

    if (!dayIndexes.length) {
      return;
    }

    (sheet.rows || []).forEach((row, rowIndex) => {
      const uniqueKey =
        row.employeeKey ||
        row.id ||
        normalizeLookupText(row.fullName) ||
        `${sheet.sheetName || 'period'}-${rowIndex}`;
      const periodDays = dayIndexes.map((day) => row.days?.[day.index]).filter(Boolean);
      const firstActiveDate = getFirstActiveDateInPeriod(periodDays);

      if (!firstActiveDate) {
        return;
      }

      const currentValue = activeMap.get(uniqueKey);
      if (!currentValue || firstActiveDate < currentValue) {
        activeMap.set(uniqueKey, firstActiveDate);
      }
    });
  });

  return activeMap;
}

function formatShortDateLabel(isoDate, locale = 'fr-FR') {
  if (!isoDate) return '--';

  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatDateTimeLabel(value, locale = 'fr-FR') {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function getTranslationValue(language, path) {
  const dictionaries = [
    UI_TRANSLATIONS[language],
    UI_EXT_TRANSLATIONS[language],
    UI_TRANSLATIONS.fr,
    UI_EXT_TRANSLATIONS.fr,
  ].filter(Boolean);

  for (const dictionary of dictionaries) {
    const value = path.split('.').reduce((current, key) => current?.[key], dictionary);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function getInitialLanguage() {
  if (typeof window === 'undefined') {
    return 'fr';
  }

  const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (LANGUAGE_OPTIONS.some((option) => option.key === storedLanguage)) {
    return storedLanguage;
  }

  const browserLanguage = String(window.navigator.language || 'fr').slice(0, 2).toLowerCase();
  if (LANGUAGE_OPTIONS.some((option) => option.key === browserLanguage)) {
    return browserLanguage;
  }

  return 'fr';
}

function getProductionServiceLabel(key, translate, fallback) {
  return translate(`production.serviceLabels.${key}`, fallback || key);
}

function translateStatusValue(value, translate) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const statusMap = {
    PRESENT: translate('status.present', 'Present'),
    PRESENTS: translate('status.present', 'Present'),
    POINTAGE: translate('status.present', 'Present'),
    AVR: translate('status.verify', 'A verifier'),
    'A VERIFIER': translate('status.verify', 'A verifier'),
    ABS: translate('status.absent', 'Absent'),
    ABSENT: translate('status.absent', 'Absent'),
    RETARD: translate('status.late', 'Retard'),
    LATE: translate('status.late', 'Retard'),
    CM: translate('status.sickLeave', 'Conge maladie'),
    'CONGE MALADIE': translate('status.sickLeave', 'Conge maladie'),
    CONGE: translate('status.leave', 'Conge'),
    CSS: translate('status.leave', 'Conge'),
    REPOS: translate('status.rest', 'Repos'),
    STC: translate('status.stc', 'STC'),
    X: translate('status.notStarted', 'Non demarre'),
    'NON DEMARRE': translate('status.notStarted', 'Non demarre'),
    ACTIF: translate('status.active', 'Actif'),
    ACTIVE: translate('status.active', 'Actif'),
    SUSPENDU: translate('status.suspended', 'Suspendu'),
    SUSPENDED: translate('status.suspended', 'Suspendu'),
    NOUVEAU: translate('status.newHire', 'Nouveau'),
    'NEW HIRE': translate('status.newHire', 'Nouveau'),
    'AUCUNE DONNEE': translate('status.noData', 'Aucune donnee'),
    'NO DATA': translate('status.noData', 'Aucune donnee'),
  };

  return statusMap[normalized] || value || '-';
}

function getEmployeeFieldLabel(fieldKey, translate) {
  return translate(`employeeFields.${fieldKey}`, fieldKey);
}

function getEditorOptionLabel(fieldKey, option, translate) {
  if (fieldKey === 'status') {
    return translateStatusValue(option, translate);
  }

  if (fieldKey === 'signed') {
    if (option === 'Oui') return translate('common.yes', 'Oui');
    if (option === 'Oui/E') return translate('common.yesElectronic', 'Oui/E');
    if (option === 'Non') return translate('common.no', 'Non');
  }

  return option;
}

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatClockFromMinutes(totalMinutes) {
  const safeMinutes = Math.max(0, Number(totalMinutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseWorkedMinutes(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function extractClockFromDateTime(value) {
  const match = String(value || '').match(/(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';
  return `${match[1]}:${match[2]}`;
}

function parseClockToMinutes(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeKindLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized.includes('MOD')) return 'MOD';
  if (normalized.includes('MOI')) return 'MOI';
  return normalized || 'AUTRE';
}

function buildKindComparison(activeEmployees, presentRoster) {
  const baseCounts = new Map();
  const presentCounts = new Map();
  const displayOrder = ['MOI', 'MOD'];

  activeEmployees.forEach((employee) => {
    const key = normalizeKindLabel(employee.kind);
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  });

  presentRoster.forEach((row) => {
    const key = normalizeKindLabel(row.kind);
    presentCounts.set(key, (presentCounts.get(key) || 0) + 1);
  });

  const allKinds = [...new Set([...displayOrder, ...baseCounts.keys(), ...presentCounts.keys()])]
    .filter((label) => label !== 'AUTRE' || baseCounts.get(label) || presentCounts.get(label));

  return allKinds.map((label) => {
    const baseCount = baseCounts.get(label) || 0;
    const presentCount = presentCounts.get(label) || 0;

    return {
      label,
      baseCount,
      presentCount,
      percent: baseCount ? (presentCount / baseCount) * 100 : 0,
    };
  });
}

function buildDepartmentComparison(activeEmployees, presentRoster) {
  const baseCounts = new Map();
  const presentCounts = new Map();

  activeEmployees.forEach((employee) => {
    const key = String(employee.department || 'Autres').trim() || 'Autres';
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  });

  presentRoster.forEach((row) => {
    const key = String(row.department || 'Autres').trim() || 'Autres';
    presentCounts.set(key, (presentCounts.get(key) || 0) + 1);
  });

  return [...new Set([...baseCounts.keys(), ...presentCounts.keys()])]
    .map((label) => {
      const baseCount = baseCounts.get(label) || 0;
      const presentCount = presentCounts.get(label) || 0;

      return {
        label,
        baseCount,
        presentCount,
        percent: baseCount ? (presentCount / baseCount) * 100 : 0,
      };
    })
    .sort((left, right) => {
      if (right.presentCount !== left.presentCount) {
        return right.presentCount - left.presentCount;
      }

      return left.label.localeCompare(right.label);
    });
}

function normalizeDepartmentValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isProductionDepartment(value) {
  return normalizeDepartmentValue(value).includes('production');
}

const PRODUCTION_SERVICE_META = {
  injection: { key: 'injection', label: 'Injection', tone: 'blue' },
  metallisation: { key: 'metallisation', label: 'Metallisation', tone: 'orange' },
  serigraphie: { key: 'serigraphie', label: 'Serigraphie', tone: 'violet' },
  assemblage: { key: 'assemblage', label: 'Assemblage', tone: 'green' },
  autres: { key: 'autres', label: 'Autres', tone: 'slate' },
};

function normalizeProductionServiceKey(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!normalized) return 'autres';
  if (normalized.includes('inj')) return 'injection';
  if (normalized.includes('met')) return 'metallisation';
  if (normalized.includes('serig')) return 'serigraphie';
  if (normalized.includes('assem')) return 'assemblage';
  return 'autres';
}

function getProductionServiceMeta(value) {
  const key = normalizeProductionServiceKey(value);
  return PRODUCTION_SERVICE_META[key] || PRODUCTION_SERVICE_META.autres;
}

function buildProductionBreakdown(rows, presentRows) {
  const total = rows.length || 1;
  const serviceCounts = new Map();
  const servicePresentCounts = new Map();
  const kindCounts = new Map();
  const kindPresentCounts = new Map();

  rows.forEach((row) => {
    const serviceMeta = getProductionServiceMeta(row.service);
    serviceCounts.set(serviceMeta.key, (serviceCounts.get(serviceMeta.key) || 0) + 1);

    const kindKey = normalizeKindLabel(row.kind);
    if (['MOI', 'MOD'].includes(kindKey)) {
      kindCounts.set(kindKey, (kindCounts.get(kindKey) || 0) + 1);
    }
  });

  presentRows.forEach((row) => {
    const serviceMeta = getProductionServiceMeta(row.service);
    servicePresentCounts.set(serviceMeta.key, (servicePresentCounts.get(serviceMeta.key) || 0) + 1);

    const kindKey = normalizeKindLabel(row.kind);
    if (['MOI', 'MOD'].includes(kindKey)) {
      kindPresentCounts.set(kindKey, (kindPresentCounts.get(kindKey) || 0) + 1);
    }
  });

  const serviceBreakdown = ['injection', 'metallisation', 'serigraphie', 'assemblage', 'autres']
    .map((key) => {
      const meta = PRODUCTION_SERVICE_META[key];
      const count = serviceCounts.get(key) || 0;
      const presentCount = servicePresentCounts.get(key) || 0;

      return {
        ...meta,
        count,
        presentCount,
        percent: (count / total) * 100,
        presentPercent: count ? (presentCount / count) * 100 : 0,
        modalKey: `production-service:${key}`,
      };
    })
    .filter((item) => item.count > 0);

  const kindMeta = {
    MOI: { key: 'MOI', label: 'MOI', tone: 'indigo' },
    MOD: { key: 'MOD', label: 'MOD', tone: 'red' },
  };
  const kindBreakdown = ['MOI', 'MOD']
    .map((key) => {
      const count = kindCounts.get(key) || 0;
      const presentCount = kindPresentCounts.get(key) || 0;

      return {
        ...kindMeta[key],
        count,
        presentCount,
        percent: (count / total) * 100,
        presentPercent: count ? (presentCount / count) * 100 : 0,
        modalKey: `production-kind:${key}`,
      };
    })
    .filter((item) => item.count > 0);

  return { serviceBreakdown, kindBreakdown };
}

function mapRosterRowToModalRow(row, overrides = {}) {
  return {
    id: row.id || row.employeeKey || '-',
    fullName: row.fullName || '-',
    department: row.department || '-',
    kind: row.kind || '-',
    status: overrides.status || row.statusLabel || 'Actif',
    detail: overrides.detail || row.service || row.rawDisplay || row.display || '-',
  };
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    return false;
  }

  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function getOperationalWeeklySheets(snapshot) {
  if (!Array.isArray(snapshot?.weeklySheets)) {
    return [];
  }

  return snapshot.weeklySheets.filter((sheet) => {
    const weekCode = String(sheet?.weekId || sheet?.sheetName || '');
    if (!/^S\d+/i.test(weekCode)) {
      return false;
    }

    return Array.isArray(sheet?.dayColumns) && sheet.dayColumns.some((day) => isValidIsoDate(day?.isoDate));
  });
}

function getAvailableDates(snapshot) {
  return [
    ...new Set(
      getOperationalWeeklySheets(snapshot).flatMap((sheet) => sheet.dayColumns?.map((day) => day.isoDate) || []),
    ),
  ]
    .filter((date) => isValidIsoDate(date))
    .sort();
}

function getDefaultSelectedDate(snapshot) {
  const dates = getAvailableDates(snapshot);
  if (!dates.length) {
    return '';
  }

  const today = getTodayIsoDate();
  if (dates.includes(today)) {
    return today;
  }

  return dates[dates.length - 1];
}

function getSelectedWeek(snapshot, selectedDate) {
  const weeklySheets = getOperationalWeeklySheets(snapshot);
  if (!weeklySheets.length) {
    return null;
  }

  return (
    weeklySheets.find((sheet) =>
      sheet.dayColumns?.some((day) => day.isoDate === selectedDate),
    ) || weeklySheets[0] || null
  );
}

function getSelectedRows(snapshot, selectedDate) {
  if (!Array.isArray(snapshot?.dayRows)) {
    return [];
  }

  return snapshot.dayRows
    .filter((row) => row.isoDate === selectedDate)
    .sort((left, right) => {
      const departmentSort = String(left.department || '').localeCompare(String(right.department || ''));
      if (departmentSort !== 0) return departmentSort;
      return String(left.matchedName || '').localeCompare(String(right.matchedName || ''));
    });
}

function getSelectedDayIndex(week, selectedDate) {
  if (!Array.isArray(week?.dayColumns)) {
    return -1;
  }

  return week.dayColumns.findIndex((day) => day.isoDate === selectedDate);
}

function getDayStatusMeta(day) {
  if (!day) {
    return {
      code: 'EMPTY',
      label: 'Aucune donnee',
      tone: 'neutral',
      isPresent: false,
    };
  }

  const statusValue = String(day.status || '').toUpperCase();
  const token = getWeeklyCellToken(day);

  switch (statusValue) {
    case 'POINTAGE':
      return { code: 'POINTAGE', label: 'Present', tone: 'green', isPresent: true };
    case 'AVR':
      return { code: 'AVR', label: 'A verifier', tone: 'orange', isPresent: true };
    case 'ABS':
      return { code: 'ABS', label: 'Absent', tone: 'red', isPresent: false };
    case 'CM':
      return { code: 'CM', label: 'Conge maladie', tone: 'violet', isPresent: false };
    case 'CONGE':
      return { code: 'CONGE', label: 'Conge', tone: 'violet', isPresent: false };
    case 'REPOS':
      return { code: 'REPOS', label: 'Repos', tone: 'slate', isPresent: false };
    case 'STC':
      return { code: 'STC', label: 'STC', tone: 'blue', isPresent: false };
    default:
      if (token === 'X') {
        return { code: 'X', label: 'Non demarre', tone: 'neutral', isPresent: false };
      }

      if (token === 'STC') {
        return { code: 'STC', label: 'STC', tone: 'blue', isPresent: false };
      }

      if (token === 'ABS') {
        return { code: 'ABS', label: 'Absent', tone: 'red', isPresent: false };
      }

      if (token === 'CM') {
        return { code: 'CM', label: 'Conge maladie', tone: 'violet', isPresent: false };
      }

      if (token === 'CSS' || token.startsWith('CONG')) {
        return { code: 'CONGE', label: 'Conge', tone: 'violet', isPresent: false };
      }

      if (token === 'REPOS') {
        return { code: 'REPOS', label: 'Repos', tone: 'slate', isPresent: false };
      }

      if (parseWorkedMinutes(day.display) > 0) {
        return { code: 'POINTAGE', label: 'Present', tone: 'green', isPresent: true };
      }

      return {
        code: 'TEXT',
        label: day.display || '-',
        tone: 'neutral',
        isPresent: false,
      };
  }
}

function isPresentWeeklyCell(day) {
  return getDayStatusMeta(day).isPresent;
}

function buildWeeklyFallbackMetrics(selectedWeek, selectedDate) {
  const dayIndex = getSelectedDayIndex(selectedWeek, selectedDate);
  if (dayIndex < 0) {
    return {
      presentEmployees: 0,
      totalRoundedMinutes: 0,
      totalRoundedClock: '--:--',
      rows: [],
    };
  }

  const rows = Array.isArray(selectedWeek?.rows) ? selectedWeek.rows : [];
  const presentRows = rows
    .map((row) => {
      const day = row.days?.[dayIndex];
      if (!isPresentWeeklyCell(day)) {
        return null;
      }

      return {
        employeeKey: row.employeeKey,
        matchedName: row.fullName,
        department: row.department,
        kind: row.kind,
        entry: '',
        workedClock: day.display || '',
        workedMinutes: parseWorkedMinutes(day.display),
      };
    })
    .filter(Boolean);

  const totalRoundedMinutes = presentRows.reduce((sum, row) => sum + row.workedMinutes, 0);

  return {
    presentEmployees: presentRows.length,
    totalRoundedMinutes,
    totalRoundedClock: presentRows.length ? formatClockFromMinutes(totalRoundedMinutes) : '00:00',
    rows: presentRows,
  };
}

function buildDayRoster(selectedWeek, selectedDate, employees = []) {
  const dayIndex = getSelectedDayIndex(selectedWeek, selectedDate);
  if (dayIndex < 0) {
    return [];
  }

  const rows = Array.isArray(selectedWeek?.rows) ? selectedWeek.rows : [];
  const findEmployeeMatch = buildEmployeeLookup(employees);

  return rows
    .map((row) => {
      const day = row.days?.[dayIndex];
      const status = getDayStatusMeta(day);
      const matchedEmployee = findEmployeeMatch(row);

      return {
        employeeKey: row.employeeKey,
        id: row.id || matchedEmployee?.finalCode || matchedEmployee?.id || matchedEmployee?.zk || '-',
        fullName: row.fullName || matchedEmployee?.fullName || '-',
        department: row.department || matchedEmployee?.department || '-',
        service: row.service || matchedEmployee?.service || '',
        kind: row.kind || matchedEmployee?.kind || '-',
        display: day?.display || '-',
        rawDisplay: day?.raw || day?.display || '-',
        totalHours: row.totalHours || '-',
        control: row.control || '-',
        statusCode: status.code,
        statusLabel: status.label,
        statusTone: status.tone,
        isPresent: status.isPresent,
      };
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function getDepartmentSegments(rows) {
  const total = rows.length || 1;
  const counts = new Map();

  rows.forEach((row) => {
    const key = String(row.department || 'Autres').trim() || 'Autres';
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const palette = ['#2f6df6', '#14c784', '#ff9f1a', '#7c5cff', '#94a3b8', '#e5e7eb'];

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, count], index) => ({
      label,
      count,
      percent: (count / total) * 100,
      color: palette[index % palette.length],
    }));
}

function getDonutBackground(segments) {
  if (!segments.length) {
    return 'conic-gradient(#e5e7eb 0 100%)';
  }

  let cursor = 0;
  const parts = segments.map((segment) => {
    const start = cursor;
    const end = cursor + segment.percent;
    cursor = end;
    return `${segment.color} ${start}% ${end}%`;
  });

  return `conic-gradient(${parts.join(', ')})`;
}

function matchesSearch(values, searchValue) {
  const normalizedSearch = String(searchValue || '').trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return values
    .map((value) => String(value || '').toLowerCase())
    .some((value) => value.includes(normalizedSearch));
}

function sortEmployeeRecords(items) {
  return [...items].sort((left, right) =>
    String(left.fullName || '').localeCompare(String(right.fullName || '')),
  );
}

function buildDepartmentBaseRows(employees) {
  const counts = new Map();

  employees.forEach((employee) => {
    const department = String(employee.department || 'Sans departement').trim() || 'Sans departement';
    const current = counts.get(department) || {
      label: department,
      total: 0,
      active: 0,
      stc: 0,
      moi: 0,
      mod: 0,
      services: new Set(),
    };

    current.total += 1;

    if (String(employee.status || '').toLowerCase() === 'actif') {
      current.active += 1;
    }

    if (String(employee.status || '').toLowerCase() === 'stc') {
      current.stc += 1;
    }

    if (normalizeKindLabel(employee.kind) === 'MOI') {
      current.moi += 1;
    }

    if (normalizeKindLabel(employee.kind) === 'MOD') {
      current.mod += 1;
    }

    if (String(employee.service || '').trim()) {
      current.services.add(String(employee.service).trim());
    }

    counts.set(department, current);
  });

  return [...counts.values()]
    .map((item) => ({
      ...item,
      serviceCount: item.services.size,
      activeRate: item.total ? (item.active / item.total) * 100 : 0,
    }))
    .sort((left, right) => right.total - left.total || left.label.localeCompare(right.label));
}

function getNextZkValue(employees) {
  const zkValues = employees
    .map((employee) => String(employee.zk || '').trim())
    .filter((value) => /^\d+$/.test(value));

  const maxValue = zkValues.length ? Math.max(...zkValues.map((value) => Number(value))) : 0;
  const width = zkValues.length ? Math.max(3, ...zkValues.map((value) => value.length)) : 3;

  return String(maxValue + 1).padStart(width, '0');
}

function getNextEmployeeCodeValue(employees) {
  const codeValues = employees
    .flatMap((employee) => [
      String(employee.id || '').trim(),
      String(employee.finalCode || '').trim(),
      String(employee.saber || '').trim(),
    ])
    .filter((value) => /^\d+$/.test(value));

  const maxValue = codeValues.length ? Math.max(...codeValues.map((value) => Number(value))) : 0;
  const width = codeValues.length ? Math.max(4, ...codeValues.map((value) => value.length)) : 4;

  return String(maxValue + 1).padStart(width, '0');
}

const TRACKED_ABSENCE_CODES = new Set(['ABS', 'CM', 'CONGE', 'REPOS']);
const HIDDEN_ABSENCE_MARKERS = new Set(['X', 'STC']);

function isHiddenAbsenceMarker(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return HIDDEN_ABSENCE_MARKERS.has(normalized);
}

function getAbsenceDetailLabel(row) {
  const rawDetail = String(row?.rawDisplay || row?.display || '').trim();
  if (!rawDetail || isHiddenAbsenceMarker(rawDetail)) {
    return '';
  }

  return rawDetail;
}

function isTrackedAbsenceRow(row) {
  const statusCode = String(row?.statusCode || '').trim().toUpperCase();
  return TRACKED_ABSENCE_CODES.has(statusCode);
}

function buildAbsenceSummary(rows) {
  const statusOrder = ['ABS', 'CM', 'CONGE', 'REPOS'];
  const counts = new Map();

  rows.forEach((row) => {
    const statusCode = String(row.statusCode || 'AUTRE').toUpperCase();
    const detailLabel = statusCode === 'CONGE' ? getAbsenceDetailLabel(row) : '';
    const key = detailLabel ? `${statusCode}:${detailLabel}` : statusCode;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...new Set([...statusOrder, ...counts.keys()])]
    .filter((key) => (counts.get(key) || 0) > 0)
    .map((key) => {
      const [statusCode, detailLabel] = String(key).split(':');
      const meta = getDayStatusMeta({ status: statusCode, display: detailLabel || statusCode });
      return {
        code: key,
        label: detailLabel || meta.label,
        tone: meta.tone,
        count: counts.get(key) || 0,
      };
    });
}

function exportEmployeeBaseWorkbook(employees, departmentRows) {
  const workbook = XLSX.utils.book_new();
  const employeeSheetRows = employees.map((employee) => ({
    Code: employee.finalCode || employee.id || employee.zk || '',
    Matricule: employee.id || '',
    ZK: employee.zk || '',
    Nom: employee.fullName || '',
    Departement: employee.department || '',
    Service: employee.service || '',
    Categorie: employee.kind || '',
    Contrat: employee.contract || '',
    Statut: employee.status || '',
    Type_Paie: employee.payType || '',
    Contrat_Signe: employee.signed || '',
    Date_Embauche: employee.hiredAt || '',
    Poste: employee.job || '',
    Inactif_Depuis: employee.inactiveFrom || '',
  }));
  const departmentSheetRows = departmentRows.map((department) => ({
    Departement: department.label,
    Total: department.total,
    Actifs: department.active,
    STC: department.stc,
    MOI: department.moi,
    MOD: department.mod,
    Services: department.serviceCount,
    Taux_Actif: Number((department.activeRate || 0).toFixed(2)),
  }));

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(employeeSheetRows), 'Base RH');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(departmentSheetRows), 'Departements');

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `base-rh-detail-${today}.xlsx`);
}

function buildKpiDetailConfig(type, data) {
  const {
    monthlyEffectifEmployees,
    presentRoster,
    absentRoster,
    lateRoster,
    newRoster,
    stcEmployees,
    selectedDate,
    periodLabel,
    totalEmployees,
    presentEmployees,
    absentEmployees,
    lateEmployees,
    newEmployees,
    stcCount,
    locale,
    labels,
    translate,
  } = data;

  switch (type) {
    case 'present':
      return {
        title: labels.presentTitle,
        subtitle: labels.presentSubtitle(formatDateLabel(selectedDate, locale), presentEmployees),
        rows: presentRoster.map((row) => ({
          id: row.id || row.employeeKey || '-',
          fullName: row.fullName || '-',
          department: row.department || '-',
          kind: row.kind || '-',
          status: row.statusLabel || translate('status.present', 'Present'),
          detail: row.display || '-',
        })),
      };
    case 'absent':
      return {
        title: labels.absentTitle,
        subtitle: labels.absentSubtitle(formatDateLabel(selectedDate, locale), absentEmployees),
        rows: absentRoster
          .filter((row) => String(row.statusCode || '').toUpperCase() === 'ABS')
          .map((row) => ({
            id: row.id || row.employeeKey || '-',
            fullName: row.fullName || '-',
            department: row.department || '-',
            kind: row.kind || '-',
            status: row.statusLabel || translate('status.absent', 'Absent'),
            detail: row.rawDisplay || row.display || '-',
          })),
      };
    case 'late':
      return {
        title: labels.lateTitle,
        subtitle: labels.lateSubtitle(formatDateLabel(selectedDate, locale), lateEmployees),
        rows: lateRoster.map((row) => ({
          id: row.id || row.employeeKey || '-',
          fullName: row.fullName || '-',
          department: row.department || '-',
          kind: row.kind || '-',
          status: row.statusLabel || translate('status.late', 'Retard'),
          detail: row.detail || row.rawDisplay || row.display || '-',
        })),
      };
    case 'new':
      return {
        title: labels.newTitle,
        subtitle: labels.newSubtitle(formatDateLabel(selectedDate, locale), newEmployees),
        rows: newRoster.map((row) => ({
          id: row.id || row.employeeKey || '-',
          fullName: row.fullName || '-',
          department: row.department || '-',
          kind: row.kind || '-',
          status: row.statusLabel || translate('status.notStarted', 'Non demarre'),
          detail: row.rawDisplay || row.display || 'X',
        })),
      };
    case 'stc':
      return {
        title: labels.stcTitle,
        subtitle: labels.stcSubtitle(stcCount, periodLabel),
        rows: stcEmployees.map((employee) => ({
          id: employee.id || employee.employeeKey || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || translate('status.stc', 'STC'),
          detail: employee.detail || '-',
        })),
      };
    case 'total':
    default:
      return {
        title: labels.totalTitle,
        subtitle: labels.totalSubtitle(totalEmployees, periodLabel),
        rows: monthlyEffectifEmployees.map((employee) => ({
          id: employee.id || employee.employeeKey || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || translate('status.active', 'Actif'),
          detail: employee.detail || '-',
        })),
      };
  }
}

function buildEmployeeBaseDetailConfig(type, data) {
  const { employees, activeEmployees, stcEmployees, labels, translate } = data;

  switch (type) {
    case 'active':
      return {
        title: labels.activeTitle,
        subtitle: labels.activeSubtitle(activeEmployees.length),
        rows: activeEmployees.map((employee) => ({
          id: employee.finalCode || employee.id || employee.zk || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || translate('status.active', 'Actif'),
          detail: employee.contract || employee.service || '-',
        })),
      };
    case 'stc':
      return {
        title: labels.stcTitle,
        subtitle: labels.stcSubtitle(stcEmployees.length),
        rows: stcEmployees.map((employee) => ({
          id: employee.finalCode || employee.id || employee.zk || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || translate('status.stc', 'STC'),
          detail: employee.inactiveFrom || employee.contract || '-',
        })),
      };
    case 'all':
    default:
      return {
        title: labels.allTitle,
        subtitle: labels.allSubtitle(employees.length),
        rows: employees.map((employee) => ({
          id: employee.finalCode || employee.id || employee.zk || '-',
          fullName: employee.fullName || '-',
          department: employee.department || '-',
          kind: employee.kind || '-',
          status: employee.status || '-',
          detail: employee.contract || employee.service || '-',
        })),
      };
  }
}

function buildProductionDetailConfig(type, data) {
  const {
    productionMetrics,
    productionDayRows,
    productionPresentRows,
    productionNewRows,
    productionStcRows,
    selectedDate,
    locale,
    labels,
    translate,
  } = data;

  if (type.startsWith('production-service:')) {
    const serviceKey = type.split(':')[1] || '';
    const serviceMeta = PRODUCTION_SERVICE_META[serviceKey] || PRODUCTION_SERVICE_META.autres;
    const rows = productionDayRows
      .filter((row) => getProductionServiceMeta(row.service).key === serviceKey)
      .map((row) => mapRosterRowToModalRow(row));

    return {
      title: `${labels.prefix} ${getProductionServiceLabel(serviceMeta.key, translate, serviceMeta.label)}`,
      subtitle: labels.percentSubtitle(rows.length, formatPercent(productionMetrics.total ? (rows.length / productionMetrics.total) * 100 : 0)),
      rows,
    };
  }

  if (type.startsWith('production-kind:')) {
    const kindKey = type.split(':')[1] || '';
    const rows = productionDayRows
      .filter((row) => normalizeKindLabel(row.kind) === kindKey)
      .map((row) => mapRosterRowToModalRow(row));

    return {
      title: `${labels.prefix} ${kindKey}`,
      subtitle: labels.percentSubtitle(rows.length, formatPercent(productionMetrics.total ? (rows.length / productionMetrics.total) * 100 : 0)),
      rows,
    };
  }

  switch (type) {
    case 'production-present':
      return {
        title: labels.presentTitle,
        subtitle: labels.presentSubtitle(productionPresentRows.length, formatDateLabel(selectedDate, locale)),
        rows: productionPresentRows.map((row) =>
          mapRosterRowToModalRow(row, { status: translate('status.present', 'Present'), detail: row.display || row.service || '-' }),
        ),
      };
    case 'production-absent':
      return {
        title: labels.absentTitle,
        subtitle: labels.absentSubtitle(productionMetrics.absent, formatDateLabel(selectedDate, locale)),
        rows: productionDayRows
          .filter((row) => String(row.statusCode || '').toUpperCase() === 'ABS')
          .map((row) => mapRosterRowToModalRow(row, { status: translate('status.absent', 'Absent'), detail: row.rawDisplay || row.service || '-' })),
      };
    case 'production-new':
      return {
        title: labels.newTitle,
        subtitle: labels.newSubtitle(productionNewRows.length, formatDateLabel(selectedDate, locale)),
        rows: productionNewRows.map((row) =>
          mapRosterRowToModalRow(row, { status: translate('status.newHire', 'Nouveau'), detail: row.rawDisplay || row.service || '-' }),
        ),
      };
    case 'production-stc':
      return {
        title: labels.stcTitle,
        subtitle: labels.stcSubtitle(productionStcRows.length),
        rows: productionStcRows.map((row) => ({
          id: row.id || row.employeeKey || '-',
          fullName: row.fullName || '-',
          department: row.department || '-',
          kind: row.kind || '-',
          status: row.status || translate('status.stc', 'STC'),
          detail: row.detail || '-',
        })),
      };
    case 'production-total':
    default:
      return {
        title: labels.totalTitle,
        subtitle: labels.totalSubtitle(productionMetrics.total),
        rows: productionDayRows.map((row) => mapRosterRowToModalRow(row)),
      };
  }
}

function KpiCard({ tone, label, value, note, tag = '', isActive = false, onClick }) {
  const Component = onClick ? 'button' : 'article';
  const isPercentNote = /%/.test(String(note || ''));
  const hasNote = Boolean(String(note || '').trim());
  const isCompactLabel = String(label || '').length > 18;

  return (
    <Component
      className={`rh-kpi-card rh-kpi-card--${tone}${onClick ? ' is-clickable' : ''}${isActive ? ' is-active' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
    >
      <div className={`rh-kpi-card__icon rh-kpi-card__icon--${tone}`} />
      <div className={`rh-kpi-card__body${tag ? ' has-tag' : ''}${isPercentNote ? ' has-percent' : ''}`}>
        {tag ? <small className="rh-kpi-card__tag">{tag}</small> : null}
        <span className={`rh-kpi-card__label${isCompactLabel ? ' is-compact' : ''}`}>{label}</span>
        <strong className={isPercentNote ? 'rh-kpi-card__value rh-kpi-card__value--accent' : 'rh-kpi-card__value'}>
          {value}
        </strong>
        {hasNote ? (
          <p className={isPercentNote ? 'rh-kpi-card__note rh-kpi-card__note--percent' : 'rh-kpi-card__note'}>
            {note}
          </p>
        ) : null}
      </div>
    </Component>
  );
}

function LanguageSwitcher({ language, onChange, title }) {
  return (
    <div className="rh-language-switcher" role="group" aria-label={title}>
      <span className="rh-language-switcher__label">{title}</span>
      <div className="rh-language-switcher__list">
        {LANGUAGE_OPTIONS.map((option) => (
          <button
            key={option.key}
            className={`rh-language-switcher__button rh-language-switcher__button--${option.key}${language === option.key ? ' is-active' : ''}`}
            type="button"
            onClick={() => onChange(option.key)}
          >
            <span className={`rh-language-switcher__flag rh-language-switcher__flag--${option.key}`} aria-hidden="true" />
            <span className="rh-language-switcher__copy">
              <strong>{option.shortLabel}</strong>
              <small>{option.label}</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function KpiDetailModal({ config, searchValue, onSearchChange, onClose, labels, translate }) {
  const filteredRows = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    if (!normalizedSearch) {
      return config.rows;
    }

    return config.rows.filter((row) =>
      [row.id, row.fullName, row.department, row.kind, row.status, row.detail]
        .map((value) => String(value || '').toLowerCase())
        .some((value) => value.includes(normalizedSearch)),
    );
  }, [config.rows, searchValue]);

  return (
    <div className="rh-modal" role="dialog" aria-modal="true" aria-labelledby="rh-kpi-modal-title">
      <button className="rh-modal__backdrop" type="button" aria-label={labels.close} onClick={onClose} />

      <article className="rh-modal__panel">
        <div className="rh-modal__header">
          <div>
            <p className="rh-eyebrow">{labels.eyebrow}</p>
            <h2 id="rh-kpi-modal-title">{config.title}</h2>
            <p>{config.subtitle}</p>
          </div>

          <div className="rh-modal__actions">
            <div className="rh-panel-pill">{labels.people(filteredRows.length)}</div>
            <button className="rh-modal__close" type="button" onClick={onClose}>
              {labels.close}
            </button>
          </div>
        </div>

        <div className="rh-modal__toolbar">
          <input
            type="search"
            value={searchValue}
            placeholder={labels.search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        <div className="rh-table-wrap rh-modal__table-wrap">
          <table className="rh-table rh-modal__table">
            <thead>
              <tr>
                <th>{labels.columns.id}</th>
                <th>{labels.columns.name}</th>
                <th>{labels.columns.department}</th>
                <th>{labels.columns.category}</th>
                <th>{labels.columns.status}</th>
                <th>{labels.columns.detail}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? (
                filteredRows.map((row, index) => (
                  <tr key={`${row.id}-${row.fullName}-${index}`}>
                    <td>{row.id || '-'}</td>
                    <td>{row.fullName || '-'}</td>
                    <td>{row.department || '-'}</td>
                    <td>{row.kind || '-'}</td>
                    <td>{translateStatusValue(row.status, translate) || '-'}</td>
                    <td>{row.detail || '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="rh-table__empty" colSpan={6}>
                    {labels.noResults}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}

function EmployeeEditorModal({
  mode,
  draft,
  deleteCode,
  isSaving,
  isDeleting,
  contractOptions,
  departmentOptions,
  serviceOptions,
  payTypeOptions,
  onChange,
  onSave,
  onDelete,
  onDeleteCodeChange,
  onClose,
  labels,
  translate,
}) {
  if (!draft) {
    return null;
  }

  const isDeleteCodeValid = ['123', 'MYC'].includes(String(deleteCode || '').trim().toUpperCase());

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="employee-editor-title">
      <button className="admin-modal__backdrop" type="button" aria-label={labels.close} onClick={onClose} />

      <article className="admin-modal__panel">
        <div className="admin-modal__header">
          <div>
            <p className="rh-eyebrow">{labels.eyebrow}</p>
            <h3 id="employee-editor-title">
              {mode === 'create' ? labels.addTitle : draft.fullName || labels.editTitle}
            </h3>
            <p>
              {mode === 'create' ? labels.addDescription : labels.editDescription}
            </p>
          </div>

          <div className="admin-modal__actions">
            <button className="ghost-button" type="button" onClick={onClose}>
              {labels.close}
            </button>
            <button className="primary-button" type="button" disabled={isSaving} onClick={onSave}>
              {isSaving ? labels.saving : mode === 'create' ? labels.add : labels.save}
            </button>
          </div>
        </div>

        <div className="admin-form-grid">
          {EMPLOYEE_FORM_FIELDS.map((field) => {
            const value = draft[field.key] || '';
            const options =
              field.key === 'contract'
                ? contractOptions
                : field.key === 'department'
                  ? departmentOptions
                  : field.key === 'service'
                    ? serviceOptions
                    : field.key === 'payType'
                      ? payTypeOptions
                      : field.key === 'status'
                        ? ['Actif', 'STC', 'Suspendu']
                        : field.key === 'kind'
                          ? ['MOI', 'MOD']
                          : field.key === 'signed'
                            ? ['Oui', 'Oui/E', 'Non']
                            : [];

            return (
              <label className="field-block" key={field.key}>
                <span>{getEmployeeFieldLabel(field.key, translate)}</span>
                {options.length ? (
                  <select value={value} onChange={(event) => onChange(field.key, event.target.value)}>
                    <option value="">{labels.choose}</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {getEditorOptionLabel(field.key, option, translate)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={value}
                    onChange={(event) => onChange(field.key, event.target.value)}
                  />
                )}
              </label>
            );
          })}
        </div>

        {mode === 'edit' ? (
          <div className="delete-zone">
            <div className="delete-zone__copy">
              <strong>{labels.deleteTitle}</strong>
              <span>{labels.deleteHint}</span>
            </div>
            <div className="delete-zone__actions">
              <input
                className="delete-zone__input"
                type="password"
                value={deleteCode}
                placeholder={labels.deletePlaceholder}
                onChange={(event) => onDeleteCodeChange(event.target.value)}
              />
              <button
                className="danger-button"
                type="button"
                disabled={!isDeleteCodeValid || isDeleting}
                onClick={onDelete}
              >
                {isDeleting ? labels.deleting : labels.delete}
              </button>
            </div>
          </div>
        ) : null}
      </article>
    </div>
  );
}

function EmployeeBaseSurface({
  employees,
  filteredEmployees,
  departmentRows,
  searchValue,
  onSearchChange,
  onCreate,
  onEdit,
  onExport,
  onOpenAll,
  onOpenActive,
  onOpenStc,
  activeEmployeesCount,
  stcEmployeesCount,
  departmentCount,
  labels,
  translate,
}) {
  return (
    <article className="admin-table-card">
      <div className="admin-workspace__hero">
        <div>
          <p className="rh-eyebrow">{labels.eyebrow}</p>
          <h2>{labels.title}</h2>
          <p>{labels.description}</p>
        </div>

        <div className="admin-workspace__actions">
          <button className="ghost-button" type="button" onClick={onExport}>
            {labels.export}
          </button>
          <button className="primary-button" type="button" onClick={onCreate}>
            {labels.add}
          </button>
        </div>
      </div>

      <div className="admin-stats">
        <button className="admin-stat-card admin-stat-card--button" type="button" onClick={onOpenAll}>
          <span>{labels.cards.records}</span>
          <strong>{employees.length}</strong>
        </button>
        <button className="admin-stat-card admin-stat-card--button" type="button" onClick={onOpenActive}>
          <span>{labels.cards.active}</span>
          <strong>{activeEmployeesCount}</strong>
        </button>
        <button className="admin-stat-card admin-stat-card--button" type="button" onClick={onOpenStc}>
          <span>{labels.cards.stc}</span>
          <strong>{stcEmployeesCount}</strong>
        </button>
      </div>

      <div className="admin-table-card__header">
        <div>
          <h3>{labels.baseTitle}</h3>
          <p>{labels.baseSubtitle(departmentCount)}</p>
        </div>

        <div className="admin-table-card__tools">
          <input
            className="admin-search"
            type="search"
            value={searchValue}
            placeholder={labels.search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      <div className="admin-table-card__summary">
        <span>{labels.visible(filteredEmployees.length)}</span>
        <span>{labels.summary(departmentRows.length)}</span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{labels.columns.code}</th>
              <th>{labels.columns.name}</th>
              <th>{labels.columns.department}</th>
              <th>{labels.columns.service}</th>
              <th>{labels.columns.category}</th>
              <th>{labels.columns.contract}</th>
              <th>{labels.columns.status}</th>
              <th>{labels.columns.action}</th>
            </tr>
          </thead>
          <tbody>
            {filteredEmployees.length ? (
              filteredEmployees.map((employee, index) => (
                <tr key={`${employee.recordId || employee.finalCode || employee.id}-${index}`}>
                  <td>{employee.finalCode || employee.id || employee.zk || '-'}</td>
                  <td>{employee.fullName || '-'}</td>
                  <td>{employee.department || '-'}</td>
                  <td>{employee.service || '-'}</td>
                  <td>{employee.kind || '-'}</td>
                  <td>{employee.contract || '-'}</td>
                  <td>{translateStatusValue(employee.status, translate) || '-'}</td>
                  <td>
                    <button className="ghost-button ghost-button--small" type="button" onClick={() => onEdit(employee)}>
                      {labels.edit}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="admin-table__empty" colSpan={8}>
                  {labels.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function ProductionFocusSection({
  productionMetrics,
  productionServiceBreakdown,
  productionKindBreakdown,
  activeModalKey,
  onOpenModal,
  labels,
}) {
  const productionModPresence = productionKindBreakdown.find((item) => item.key === 'MOD') || null;

  return (
    <section className="rh-section-block">
      <div className="rh-section-block__header">
        <div>
          <p className="rh-eyebrow">{labels.focus}</p>
          <h3>{labels.title}</h3>
        </div>
        <span className="rh-panel-pill">{labels.employeesFollowed(productionMetrics.total)}</span>
      </div>

      <div className="rh-kpi-grid rh-kpi-grid--department">
        <KpiCard
          tone="indigo"
          label={labels.productionWorkforce}
          value={productionMetrics.total}
          note={productionMetrics.periodLabel}
          isActive={activeModalKey === 'production-total'}
          onClick={() => onOpenModal('production-total')}
        />
        <KpiCard
          tone="green"
          label={labels.presents}
          value={productionMetrics.present}
          note={formatPercent(productionMetrics.presentRate)}
          isActive={activeModalKey === 'production-present'}
          onClick={() => onOpenModal('production-present')}
        />
        <KpiCard
          tone="orange"
          label={labels.absents}
          value={productionMetrics.absent}
          note={formatPercent(productionMetrics.absentRate)}
          isActive={activeModalKey === 'production-absent'}
          onClick={() => onOpenModal('production-absent')}
        />
        <KpiCard
          tone="slate"
          label={labels.recruitments}
          value={productionMetrics.newEmployees}
          note=""
          isActive={activeModalKey === 'production-new'}
          onClick={() => onOpenModal('production-new')}
        />
        <KpiCard
          tone="blue"
          label={labels.stcMonth}
          value={productionMetrics.stc}
          note={formatPercent(productionMetrics.stcRate)}
          isActive={activeModalKey === 'production-stc'}
          onClick={() => onOpenModal('production-stc')}
        />
      </div>

      <div className="rh-production-breakdown">
        <div className="rh-production-breakdown__topline">
          <div className="rh-production-breakdown__group rh-production-breakdown__group--presence">
            <div className="rh-production-breakdown__title">{labels.kindPresence}</div>
            <div className="rh-production-breakdown__stack">
              {productionModPresence ? (
                <button
                  key={`presence-${productionModPresence.key}`}
                  className={`rh-production-presence-card rh-production-presence-card--${productionModPresence.tone}${activeModalKey === productionModPresence.modalKey ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => onOpenModal(productionModPresence.modalKey)}
                  style={{ '--presence-angle': `${Math.max(0, Math.min(360, productionModPresence.presentPercent * 3.6))}deg` }}
                >
                  <div className="rh-production-presence-card__header">
                    <span>{productionModPresence.label}</span>
                    <small>{labels.kindPresence}</small>
                  </div>
                  <div className="rh-production-presence-card__body">
                    <div className={`rh-production-presence-card__ring rh-production-presence-card__ring--${productionModPresence.tone}`}>
                      <div className="rh-production-presence-card__ring-core">
                        <strong>{formatPercent(productionModPresence.presentPercent)}</strong>
                        <span>{labels.presence}</span>
                      </div>
                    </div>
                    <div className="rh-production-presence-card__stats">
                      <div className="rh-production-presence-card__stat">
                        <small>{labels.presents}</small>
                        <b>{productionModPresence.presentCount}</b>
                      </div>
                      <div className="rh-production-presence-card__stat">
                        <small>{labels.total}</small>
                        <b>{productionModPresence.count}</b>
                      </div>
                      <div className="rh-production-presence-card__hint">Clique pour ouvrir la liste</div>
                    </div>
                  </div>
                </button>
              ) : null}
            </div>
          </div>

          <div className="rh-production-breakdown__group rh-production-breakdown__group--categories">
            <div className="rh-production-breakdown__title">{labels.productionCategories}</div>
            <div className="rh-production-breakdown__grid rh-production-breakdown__grid--categories">
              {productionKindBreakdown.map((item) => (
                <button
                  key={item.key}
                  className={`rh-production-chip rh-production-chip--${item.tone}${activeModalKey === item.modalKey ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => onOpenModal(item.modalKey)}
                >
                  <span>{item.label}</span>
                  <div className="rh-production-chip__stats">
                    <div className="rh-production-chip__stat">
                      <small>{labels.total}</small>
                      <strong>{item.count}</strong>
                    </div>
                    <div className="rh-production-chip__stat">
                      <small>{labels.presents}</small>
                      <strong>{item.presentCount}</strong>
                    </div>
                  </div>
                  <div className="rh-production-chip__percent-row">
                    <small>{labels.presence}</small>
                    <strong className="rh-production-chip__percent">{formatPercent(item.presentPercent)}</strong>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rh-production-breakdown__group rh-production-breakdown__group--full">
          <div className="rh-production-breakdown__title">{labels.productionTypes}</div>
          <div className="rh-production-breakdown__grid">
            {productionServiceBreakdown.map((item) => (
              <button
                key={item.key}
                className={`rh-production-chip rh-production-chip--${item.tone}${activeModalKey === item.modalKey ? ' is-active' : ''}`}
                type="button"
                onClick={() => onOpenModal(item.modalKey)}
              >
                <span>{`${labels.prefix} ${labels.serviceLabel(item.key, item.label)}`}</span>
                <div className="rh-production-chip__stats">
                  <div className="rh-production-chip__stat">
                    <small>{labels.total}</small>
                    <strong>{item.count}</strong>
                  </div>
                  <div className="rh-production-chip__stat">
                    <small>{labels.presents}</small>
                    <strong>{item.presentCount}</strong>
                  </div>
                </div>
                <div className="rh-production-chip__percent-row">
                  <small>{labels.presence}</small>
                  <strong className="rh-production-chip__percent">{formatPercent(item.presentPercent)}</strong>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DepartmentBaseSurface({
  tableTitle,
  tableSubtitle,
  searchValue,
  onSearchChange,
  departmentBaseRows,
  filteredDepartmentBaseRows,
  baseServiceCount,
  activeEmployeesCount,
  stcEmployeesCount,
  productionMetrics,
  productionServiceBreakdown,
  productionKindBreakdown,
  activeProductionModal,
  onOpenProductionModal,
  productionLabels,
  labels,
}) {
  return (
    <article className="rh-card rh-card--base">
      <div className="rh-base-surface">
        <div className="rh-base-surface__hero">
          <div>
            <p className="rh-eyebrow">{labels.eyebrow}</p>
            <h2>{tableTitle}</h2>
            <p>{tableSubtitle}</p>
          </div>

          <div className="rh-table-tools">
            <input
              type="search"
              value={searchValue}
              placeholder={labels.search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
        </div>

        <div className="rh-base-metrics">
          <article className="rh-base-metric">
            <span>{labels.metrics.departments}</span>
            <strong>{departmentBaseRows.length}</strong>
          </article>
          <article className="rh-base-metric">
            <span>{labels.metrics.services}</span>
            <strong>{baseServiceCount}</strong>
          </article>
          <article className="rh-base-metric">
            <span>{labels.metrics.active}</span>
            <strong>{activeEmployeesCount}</strong>
          </article>
          <article className="rh-base-metric">
            <span>{labels.metrics.stc}</span>
            <strong>{stcEmployeesCount}</strong>
          </article>
        </div>

        <div className="rh-table-wrap">
          <table className="rh-table">
            <thead>
              <tr>
                <th>{labels.columns.department}</th>
                <th>{labels.columns.totalBase}</th>
                <th>{labels.columns.active}</th>
                <th>STC</th>
                <th>MOI</th>
                <th>MOD</th>
                <th>{labels.columns.services}</th>
                <th>{labels.columns.activeRate}</th>
              </tr>
            </thead>
            <tbody>
              {filteredDepartmentBaseRows.length ? (
                filteredDepartmentBaseRows.map((department) => (
                  <tr key={department.label}>
                    <td>{department.label}</td>
                    <td>{department.total}</td>
                    <td>{department.active}</td>
                    <td>{department.stc}</td>
                    <td>{department.moi}</td>
                    <td>{department.mod}</td>
                    <td>{department.serviceCount}</td>
                    <td>{formatPercent(department.activeRate)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="rh-table__empty" colSpan={8}>
                    {labels.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <ProductionFocusSection
          productionMetrics={productionMetrics}
          productionServiceBreakdown={productionServiceBreakdown}
          productionKindBreakdown={productionKindBreakdown}
          activeModalKey={activeProductionModal}
          onOpenModal={onOpenProductionModal}
          labels={productionLabels}
        />
      </div>
    </article>
  );
}

function AbsenceSurface({
  selectedDate,
  rows,
  summary,
  searchValue,
  onSearchChange,
  labels,
  locale,
  translate,
}) {
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        matchesSearch(
          [row.id, row.fullName, row.department, row.kind, row.statusLabel, getAbsenceDetailLabel(row)],
          searchValue,
        ),
      ),
    [rows, searchValue],
  );

  return (
    <article className="rh-card rh-card--base">
      <div className="rh-base-surface">
        <div className="rh-base-surface__hero">
          <div>
            <p className="rh-eyebrow">{labels.eyebrow}</p>
            <h2>{labels.title}</h2>
            <p>{labels.subtitle(formatDateLabel(selectedDate, locale))}</p>
          </div>

          <div className="rh-table-tools">
            <input
              type="search"
              value={searchValue}
              placeholder={labels.search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
        </div>

        <div className="rh-base-metrics">
          {summary.length ? (
            summary.map((item) => (
              <article className="rh-base-metric" key={item.code}>
                <span>{translateStatusValue(item.label, translate)}</span>
                <strong>{item.count}</strong>
              </article>
            ))
          ) : (
            <article className="rh-base-metric">
              <span>{labels.none}</span>
              <strong>0</strong>
            </article>
          )}
        </div>

        <div className="rh-table-wrap">
          <table className="rh-table">
            <thead>
              <tr>
                <th>ID ZK</th>
                <th>{translate('table.name', 'Nom')}</th>
                <th>{translate('table.department', 'Departement')}</th>
                <th>{translate('table.category', 'Categorie')}</th>
                <th>{labels.columns.type}</th>
                <th>{labels.columns.detail}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length ? (
                filteredRows.map((row, index) => (
                  <tr key={`${row.employeeKey}-${row.id}-${index}`}>
                    <td>{row.id || '-'}</td>
                    <td>{row.fullName || '-'}</td>
                    <td>{row.department || '-'}</td>
                    <td>{row.kind || '-'}</td>
                    <td>
                      <span className={`rh-panel-badge rh-panel-badge--${row.statusTone}`}>
                        {translateStatusValue(row.statusLabel, translate) || '-'}
                      </span>
                    </td>
                    <td>{getAbsenceDetailLabel(row) || '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="rh-table__empty" colSpan={6}>
                    {labels.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}

function Sidebar({
  activeSection,
  onSelect,
  periodLabel,
  periodRange,
  latestImportLabel,
  sidebarOpen,
  items,
  labels,
}) {
  return (
    <aside className={`rh-sidebar${sidebarOpen ? ' is-open' : ''}`}>
      <div className="rh-sidebar__brand">
        <img src={mycLogoUrl} alt="MYC Beauty Innovation Tunisia" />
        <div>
          <strong>MYC</strong>
          <span>Beauty Innovation Tunisia</span>
        </div>
      </div>

      <div className="rh-sidebar__label">{labels.navigation}</div>

      <nav className="rh-sidebar__nav" aria-label={labels.aria}>
        {items.map((item) => (
          <button
            key={item.key}
            className={`rh-sidebar__item${activeSection === item.key ? ' is-active' : ''}`}
            type="button"
            onClick={() => onSelect(item.key)}
          >
            <span className="rh-sidebar__bullet" />
            <span className="rh-sidebar__item-copy">
              <strong>{item.label}</strong>
              <small>{item.note}</small>
            </span>
          </button>
        ))}
      </nav>

      <div className="rh-sidebar__footer">
        <div className="rh-sidebar__period">
          <span>{labels.activePeriod}</span>
          <strong>{periodLabel}</strong>
          <p>{periodRange}</p>
        </div>
        <div className="rh-sidebar__period">
          <span>{labels.latestImport}</span>
          <strong>{latestImportLabel}</strong>
          <p>{labels.syncedBase}</p>
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  const [language, setLanguage] = useState(getInitialLanguage);
  const [employees, setEmployees] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [activeSection, setActiveSection] = useState('dashboard');
  const [statusMessage, setStatusMessage] = useState(() => getTranslationValue(getInitialLanguage(), 'messages.initialStatus'));
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeKpiModal, setActiveKpiModal] = useState('');
  const [activeEmployeeBaseModal, setActiveEmployeeBaseModal] = useState('');
  const [activeProductionModal, setActiveProductionModal] = useState('');
  const [kpiSearchValue, setKpiSearchValue] = useState('');
  const [employeeEditorMode, setEmployeeEditorMode] = useState('closed');
  const [employeeDraft, setEmployeeDraft] = useState(null);
  const [deleteCode, setDeleteCode] = useState('');
  const [isEmployeeSaving, setIsEmployeeSaving] = useState(false);
  const [isEmployeeDeleting, setIsEmployeeDeleting] = useState(false);
  const locale = LANGUAGE_LOCALES[language] || LANGUAGE_LOCALES.fr;
  const languageDirection = language === 'ar' ? 'rtl' : 'ltr';
  const translate = (path, fallback = path) => {
    const value = getTranslationValue(language, path);
    return typeof value === 'string' ? value : fallback;
  };
  const translateFn = (path, fallback) => {
    const value = getTranslationValue(language, path);
    return typeof value === 'function' ? value : fallback;
  };
  const sidebarItems = useMemo(
    () =>
      SIDEBAR_ITEMS.map((item) => ({
        ...item,
        label: translate(`sidebar.items.${item.key}.label`, item.label),
        note: translate(`sidebar.items.${item.key}.note`, item.note),
      })),
    [language],
  );
  const sidebarLabels = useMemo(
    () => ({
      navigation: translate('sidebar.navigation', 'Navigation'),
      aria: translate('sidebar.aria', 'Dashboard navigation'),
      activePeriod: translate('sidebar.activePeriod', 'Periode active'),
      latestImport: translate('sidebar.latestImport', 'Dernier import'),
      syncedBase: translate('sidebar.syncedBase', 'Base RH synchronisee'),
    }),
    [language],
  );
  const productionLabels = useMemo(
    () => ({
      focus: translate('production.focus', 'Focus departement'),
      title: translate('production.title', 'Production'),
      employeesFollowed: translateFn('production.employeesFollowed', (count) => `${count} employe(s) suivis`),
      productionWorkforce: translate('kpi.productionWorkforce', 'Effectif de production'),
      presents: translate('kpi.presents', 'Presents'),
      absents: translate('kpi.absents', 'Absents'),
      recruitments: translate('kpi.recruitments', 'Nombre de recrutements'),
      stcMonth: translate('kpi.stcMonth', 'STC du mois'),
      productionTypes: translate('production.productionTypes', 'Types de production'),
      kindPresence: translate('production.kindPresence', 'Presence MOI / MOD'),
      productionCategories: translate('production.productionCategories', 'Categories production'),
      serviceLabel: (key, fallback) => getProductionServiceLabel(key, translate, fallback),
      total: translate('production.total', 'Total'),
      presence: translate('production.presence', 'Presence'),
      prefix: translate('production.prefix', 'Production -'),
    }),
    [language],
  );
  const modalLabels = useMemo(
    () => ({
      eyebrow: translate('modal.eyebrow', 'Detail KPI'),
      close: translate('modal.close', 'Fermer'),
      people: translateFn('modal.people', (count) => `${count} personnes`),
      search: translate('modal.search', 'Rechercher une personne...'),
      noResults: translate('modal.noResults', 'Aucun resultat pour cette recherche.'),
      columns: {
        id: translate('modal.columns.id', 'ID'),
        name: translate('modal.columns.name', 'Nom'),
        department: translate('modal.columns.department', 'Departement'),
        category: translate('modal.columns.category', 'Categorie'),
        status: translate('modal.columns.status', 'Statut'),
        detail: translate('modal.columns.detail', 'Detail'),
      },
    }),
    [language],
  );
  const employeeEditorLabels = useMemo(
    () => ({
      eyebrow: translate('employeeEditor.eyebrow', 'Base RH'),
      addTitle: translate('employeeEditor.addTitle', 'Ajouter un employe'),
      editTitle: translate('employeeEditor.editTitle', 'Modifier la fiche employe'),
      addDescription: translate('employeeEditor.addDescription', 'Complete la fiche puis sauvegarde pour l enregistrer dans la base.'),
      editDescription: translate('employeeEditor.editDescription', 'Modifie les informations de la fiche puis sauvegarde les changements.'),
      close: translate('employeeEditor.close', 'Fermer'),
      add: translate('employeeEditor.add', 'Ajouter'),
      save: translate('employeeEditor.save', 'Enregistrer'),
      saving: translate('employeeEditor.saving', 'Sauvegarde...'),
      choose: translate('employeeEditor.choose', 'Choisir...'),
      deleteTitle: translate('employeeEditor.deleteTitle', 'Supprimer cette fiche'),
      deleteHint: translate('employeeEditor.deleteHint', 'Entre `123` ou `MYC` pour autoriser la suppression de cet utilisateur.'),
      deletePlaceholder: translate('employeeEditor.deletePlaceholder', 'Code 123 ou MYC'),
      deleting: translate('employeeEditor.deleting', 'Suppression...'),
      delete: translate('employeeEditor.delete', 'Supprimer'),
    }),
    [language],
  );
  const employeeBaseLabels = useMemo(
    () => ({
      eyebrow: translate('employeeBase.eyebrow', 'Base RH enregistree'),
      title: translate('employeeBase.title', 'Gestion des employes'),
      description: translate('employeeBase.description', 'Ajoute, modifie ou supprime un utilisateur directement depuis la base RH sauvegardee.'),
      export: translate('employeeBase.export', 'Exporter Excel'),
      add: translate('employeeBase.add', 'Ajouter un employe'),
      cards: {
        records: translate('employeeBase.cards.records', 'Fiches RH'),
        active: translate('employeeBase.cards.active', 'Actifs'),
        stc: translate('employeeBase.cards.stc', 'STC'),
      },
      baseTitle: translate('employeeBase.baseTitle', 'Base du personnel'),
      baseSubtitle: translateFn('employeeBase.baseSubtitle', (count) => `${count} departement(s) relies a cette base.`),
      search: translate('employeeBase.search', 'Rechercher un employe, service, code...'),
      visible: translateFn('employeeBase.visible', (count) => `${count} fiche(s) visibles`),
      summary: translateFn('employeeBase.summary', (count) => `${count} departement(s) dans la base RH. Clique sur Modifier pour ouvrir la fiche.`),
      columns: {
        code: translate('employeeBase.columns.code', 'Code'),
        name: translate('employeeBase.columns.name', 'Nom'),
        department: translate('employeeBase.columns.department', 'Departement'),
        service: translate('employeeBase.columns.service', 'Service'),
        category: translate('employeeBase.columns.category', 'Categorie'),
        contract: translate('employeeBase.columns.contract', 'Contrat'),
        status: translate('employeeBase.columns.status', 'Statut'),
        action: translate('employeeBase.columns.action', 'Action'),
      },
      edit: translate('employeeBase.edit', 'Modifier'),
      empty: translate('employeeBase.empty', 'Aucun employe trouve pour cette recherche.'),
    }),
    [language],
  );
  const departmentBaseLabels = useMemo(
    () => ({
      eyebrow: translate('departmentBase.eyebrow', 'Base RH enregistree'),
      search: translate('departmentBase.search', 'Rechercher un departement...'),
      metrics: {
        departments: translate('departmentBase.metrics.departments', 'Departements'),
        services: translate('departmentBase.metrics.services', 'Services'),
        active: translate('departmentBase.metrics.active', 'Actifs'),
        stc: translate('departmentBase.metrics.stc', 'STC'),
      },
      columns: {
        department: translate('departmentBase.columns.department', 'Departement'),
        totalBase: translate('departmentBase.columns.totalBase', 'Total base'),
        active: translate('departmentBase.columns.active', 'Actifs'),
        services: translate('departmentBase.columns.services', 'Services'),
        activeRate: translate('departmentBase.columns.activeRate', 'Taux actif'),
      },
      empty: translate('departmentBase.empty', 'Aucun departement trouve pour cette recherche.'),
    }),
    [language],
  );
  const absenceLabels = useMemo(
    () => ({
      eyebrow: translate('absences.eyebrow', 'Suivi des absences'),
      title: translate('absences.title', 'ABSENCES & CONGES'),
      subtitle: translateFn('absences.subtitle', (date) => `${date} | Detail des ABS, CM, conges et repos du jour.`),
      search: translate('absences.search', 'Rechercher une absence ou un conge...'),
      none: translate('absences.none', 'Aucune absence'),
      empty: translate('absences.empty', 'Aucune absence ou aucun conge trouve pour cette recherche.'),
      columns: {
        type: translate('absences.columns.type', 'Type'),
        detail: translate('absences.columns.detail', 'Detail'),
      },
    }),
    [language],
  );
  const kpiDetailLabels = useMemo(
    () => ({
      presentTitle: translate('kpi.presentListTitle', 'Liste des presents'),
      presentSubtitle: (date, count) => `${count} ${translate('kpi.presents', 'Presents').toLowerCase()} | ${date}`,
      absentTitle: translate('kpi.absentListTitle', 'Liste des absents'),
      absentSubtitle: (date, count) => `${count} ${translate('kpi.absents', 'Absents').toLowerCase()} | ${date}`,
      lateTitle: translate('kpi.lateListTitle', 'Liste des retards'),
      lateSubtitle: (date, count) => `${count} ${translate('kpi.late', 'Retards').toLowerCase()} | ${date}`,
      newTitle: translate('kpi.newListTitle', 'Liste des nouveaux'),
      newSubtitle: (date, count) => `${count} | ${date}`,
      stcTitle: translate('kpi.stcListTitle', 'Liste STC du mois'),
      stcSubtitle: (count, periodLabel) => `${count} ${translate('kpi.stcMonth', 'STC du mois')} | ${periodLabel}`,
      totalTitle: translate('kpi.totalListTitle', 'Effectif du mois'),
      totalSubtitle: (count, periodLabel) => `${count} | ${periodLabel}`,
    }),
    [language],
  );
  const employeeBaseDetailLabels = useMemo(
    () => ({
      activeTitle: translate('employeeBase.activeListTitle', 'Liste des employes actifs'),
      activeSubtitle: (count) => `${count} ${translate('employeeBase.cards.active', 'Actifs').toLowerCase()}`,
      stcTitle: translate('employeeBase.stcListTitle', 'Liste STC base RH'),
      stcSubtitle: (count) => `${count} STC`,
      allTitle: translate('employeeBase.allListTitle', 'Liste complete base RH'),
      allSubtitle: (count) => `${count} ${translate('employeeBase.cards.records', 'Fiches RH').toLowerCase()}`,
    }),
    [language],
  );
  const productionDetailLabels = useMemo(
    () => ({
      prefix: translate('production.prefix', 'Production -'),
      percentSubtitle: (count, percent) => `${count} | ${percent}`,
      presentTitle: `${translate('production.prefix', 'Production -')} ${translate('kpi.presents', 'Presents')}`,
      presentSubtitle: (count, date) => `${count} ${translate('kpi.presents', 'Presents').toLowerCase()} | ${date}`,
      absentTitle: `${translate('production.prefix', 'Production -')} ${translate('kpi.absents', 'Absents')}`,
      absentSubtitle: (count, date) => `${count} ${translate('kpi.absents', 'Absents').toLowerCase()} | ${date}`,
      newTitle: `${translate('production.prefix', 'Production -')} ${translate('kpi.recruitments', 'Nombre de recrutements')}`,
      newSubtitle: (count, date) => `${count} | ${date}`,
      stcTitle: `${translate('production.prefix', 'Production -')} ${translate('kpi.stcMonth', 'STC du mois')}`,
      stcSubtitle: (count) => `${count} STC`,
      totalTitle: `${translate('production.prefix', 'Production -')} ${translate('kpi.productionWorkforce', 'Effectif de production')}`,
      totalSubtitle: (count) => `${count} ${translate('production.title', 'Production').toLowerCase()}`,
    }),
    [language],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrapDashboard() {
      const [employeesResult, snapshotResult] = await Promise.all([
        loadEmployees(),
        loadPointageSnapshot(),
      ]);
      if (cancelled) return;

      setEmployees(Array.isArray(employeesResult.data) ? employeesResult.data : []);
      setSnapshot(snapshotResult.data || null);
      setStatusMessage(snapshotResult.message || employeesResult.message || translate('messages.dashboardReady', 'Dashboard RH pret.'));
      setSelectedDate(getDefaultSelectedDate(snapshotResult.data));
      setIsLoading(false);
    }

    bootstrapDashboard();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }
    document.documentElement.lang = locale;
    document.documentElement.dir = languageDirection;
  }, [language, locale, languageDirection]);

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      setStatusMessage(translate('messages.analyzingFile', 'Analyse du fichier Excel en cours...'));
      const nextSnapshot = await analyzePointageFile(file, employees);
      setStatusMessage(translate('messages.replacingBase', 'Remplacement de la base pointage en cours...'));
      const saveResult = await replacePointageSnapshot(nextSnapshot);
      const savedSnapshot = saveResult.data || nextSnapshot;
      setSnapshot(savedSnapshot);
      setSelectedDate(getDefaultSelectedDate(savedSnapshot));
      setStatusMessage(saveResult.message || translate('messages.importDone', 'Fichier Excel importe.'));
      setActiveSection('dashboard');
    } catch (error) {
      setStatusMessage(error.message || translate('messages.importError', 'Import Excel impossible.'));
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  }

  function handleSelectSection(sectionKey) {
    setActiveSection(sectionKey);
    setSidebarOpen(false);
  }

  function handleOpenKpiModal(type) {
    setActiveKpiModal(type);
    setKpiSearchValue('');
  }

  function handleCloseKpiModal() {
    setActiveKpiModal('');
    setKpiSearchValue('');
  }

  function handleOpenEmployeeBaseModal(type) {
    setActiveEmployeeBaseModal(type);
    setKpiSearchValue('');
  }

  function handleCloseEmployeeBaseModal() {
    setActiveEmployeeBaseModal('');
    setKpiSearchValue('');
  }

  function handleOpenProductionModal(type) {
    setActiveProductionModal(type);
    setKpiSearchValue('');
  }

  function handleCloseProductionModal() {
    setActiveProductionModal('');
    setKpiSearchValue('');
  }

  function handleOpenCreateEmployee() {
    const nextZk = getNextZkValue(employees);
    const nextCode = getNextEmployeeCodeValue(employees);
    setEmployeeEditorMode('create');
    setEmployeeDraft({
      ...createEmptyEmployee(),
      id: nextCode,
      zk: nextZk,
      saber: nextCode,
      finalCode: nextCode,
    });
    setDeleteCode('');
  }

  function handleOpenEditEmployee(employee) {
    setEmployeeEditorMode('edit');
    setEmployeeDraft({ ...employee });
    setDeleteCode('');
  }

  function handleCloseEmployeeEditor() {
    setEmployeeEditorMode('closed');
    setEmployeeDraft(null);
    setDeleteCode('');
  }

  function handleEmployeeDraftChange(field, value) {
    setEmployeeDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  const availableDates = useMemo(() => getAvailableDates(snapshot), [snapshot]);
  const selectedWeek = useMemo(() => getSelectedWeek(snapshot, selectedDate), [snapshot, selectedDate]);
  const sourceRowsForDate = useMemo(() => getSelectedRows(snapshot, selectedDate), [snapshot, selectedDate]);
  const sourceSummaryForDate = useMemo(
    () => snapshot?.dailySummaries?.find((item) => item.isoDate === selectedDate) || null,
    [snapshot, selectedDate],
  );
  const weeklyFallback = useMemo(
    () => buildWeeklyFallbackMetrics(selectedWeek, selectedDate),
    [selectedWeek, selectedDate],
  );
  const selectedRows = sourceRowsForDate.length ? sourceRowsForDate : weeklyFallback.rows;
  const selectedSummary = sourceRowsForDate.length
    ? sourceSummaryForDate
    : {
        presentEmployees: weeklyFallback.presentEmployees,
        totalRoundedClock: weeklyFallback.totalRoundedClock,
        totalRoundedMinutes: weeklyFallback.totalRoundedMinutes,
      };

  const dayRoster = useMemo(
    () => buildDayRoster(selectedWeek, selectedDate, employees),
    [employees, selectedWeek, selectedDate],
  );
  const activePeriodStart = availableDates[0] || '';
  const activePeriodEnd = availableDates[availableDates.length - 1] || '';
  const activePeriodLabel = useMemo(
    () => formatPeriodLabel(activePeriodStart, activePeriodEnd, locale, translate('common.to', 'au')),
    [activePeriodEnd, activePeriodStart, language],
  );
  const activeEmployees = useMemo(
    () => employees.filter((employee) => String(employee.status || '').toLowerCase() === 'actif'),
    [employees],
  );
  const stcEmployees = useMemo(
    () => employees.filter((employee) => String(employee.status || '').toLowerCase() === 'stc'),
    [employees],
  );
  const firstStcDateMap = useMemo(
    () => buildFirstStcDateMap(snapshot, activePeriodStart, activePeriodEnd),
    [activePeriodEnd, activePeriodStart, snapshot],
  );
  const firstActiveDateMap = useMemo(
    () => buildFirstActiveDateMap(snapshot, activePeriodStart, activePeriodEnd),
    [activePeriodEnd, activePeriodStart, snapshot],
  );
  const selectedTableEmployees = useMemo(
    () => buildPeriodEmployees(snapshot, activePeriodStart, activePeriodEnd, employees),
    [activePeriodEnd, activePeriodStart, employees, snapshot],
  );
  const selectedDayEffectifRows = useMemo(
    () => dayRoster.filter((row) => !['EMPTY', 'X'].includes(String(row.statusCode || '').toUpperCase())),
    [dayRoster],
  );
  const productionDayRows = useMemo(
    () => selectedDayEffectifRows.filter((row) => isProductionDepartment(row.department)),
    [selectedDayEffectifRows],
  );
  const newRoster = useMemo(
    () =>
      selectedDayEffectifRows
        .filter((row) => firstActiveDateMap.get(row.employeeKey) === selectedDate)
        .map((row) => ({
          ...row,
          statusLabel: 'Nouveau',
          rawDisplay: firstActiveDateMap.get(row.employeeKey)
            ? formatShortDateLabel(firstActiveDateMap.get(row.employeeKey))
            : row.rawDisplay || row.display || '-',
          display: firstActiveDateMap.get(row.employeeKey)
            ? formatShortDateLabel(firstActiveDateMap.get(row.employeeKey))
            : row.display || '-',
        })),
    [firstActiveDateMap, selectedDate, selectedDayEffectifRows],
  );
  const selectedDayStcRows = useMemo(
    () => selectedDayEffectifRows.filter((row) => String(row.statusCode || '').toUpperCase() === 'STC'),
    [selectedDayEffectifRows],
  );
  const monthlyStcEmployees = useMemo(
    () =>
      selectedDayStcRows.map((row) => ({
        employeeKey: row.employeeKey,
        id: row.id || row.employeeKey || '-',
        fullName: row.fullName || '-',
        department: row.department || '-',
        kind: row.kind || '-',
        status: 'STC',
        detail: firstStcDateMap.get(row.employeeKey)
          ? formatShortDateLabel(firstStcDateMap.get(row.employeeKey))
          : row.rawDisplay || row.display || 'STC',
      })),
    [firstStcDateMap, selectedDayStcRows],
  );
  const monthlyEffectifEmployees = useMemo(
    () =>
      selectedDayEffectifRows.map((row) => ({
        employeeKey: row.employeeKey,
        id: row.id || row.employeeKey || '-',
        fullName: row.fullName || '-',
        department: row.department || '-',
        kind: row.kind || '-',
        status: row.statusCode === 'STC' ? 'STC' : row.statusLabel || 'Actif',
        detail:
          row.statusCode === 'STC'
            ? firstStcDateMap.get(row.employeeKey)
              ? formatShortDateLabel(firstStcDateMap.get(row.employeeKey))
              : row.rawDisplay || row.display || 'STC'
            : row.statusCode === 'ABS' || row.statusCode === 'CM' || row.statusCode === 'CONGE'
              ? row.statusLabel || row.rawDisplay || row.display || '-'
              : row.rawDisplay || row.display || '-',
      })),
    [firstStcDateMap, selectedDayEffectifRows],
  );
  const presentRoster = useMemo(
    () => dayRoster.filter((row) => row.isPresent),
    [dayRoster],
  );
  const lateRoster = useMemo(
    () =>
      dayRoster
        .filter((row) => {
          if (!row.isPresent) return false;
          const sourceValue = row.rawDisplay || row.display || '';
          const lateMinutes = parseWorkedMinutes(sourceValue);
          return lateMinutes > 7 * 60 + 30;
        })
        .map((row) => ({
          id: row.id || row.employeeKey || '-',
          fullName: row.fullName || '-',
          department: row.department || '-',
          kind: row.kind || '-',
          status: 'Retard',
          detail: row.rawDisplay || row.display || '-',
        })),
    [dayRoster],
  );
  const productionPresentRows = useMemo(
    () => presentRoster.filter((row) => isProductionDepartment(row.department)),
    [presentRoster],
  );
  const absenceRoster = useMemo(
    () => dayRoster.filter((row) => !row.isPresent && isTrackedAbsenceRow(row)),
    [dayRoster],
  );
  const productionNewRows = useMemo(
    () => newRoster.filter((row) => isProductionDepartment(row.department)),
    [newRoster],
  );
  const productionStcRows = useMemo(
    () => monthlyStcEmployees.filter((row) => isProductionDepartment(row.department)),
    [monthlyStcEmployees],
  );
  const { serviceBreakdown: productionServiceBreakdown, kindBreakdown: productionKindBreakdown } = useMemo(
    () => buildProductionBreakdown(productionDayRows, productionPresentRows),
    [productionDayRows, productionPresentRows],
  );
  const kindComparison = useMemo(
    () => buildKindComparison(activeEmployees, presentRoster),
    [activeEmployees, presentRoster],
  );
  const departmentComparison = useMemo(
    () => buildDepartmentComparison(activeEmployees, presentRoster),
    [activeEmployees, presentRoster],
  );

  const departmentSegments = useMemo(() => getDepartmentSegments(selectedRows), [selectedRows]);
  const filteredWeekRows = useMemo(() => {
    const rows = Array.isArray(selectedWeek?.rows) ? selectedWeek.rows : [];
    return rows.filter((row) =>
      matchesSearch([row.id, row.fullName, row.department, row.kind], searchValue),
    );
  }, [searchValue, selectedWeek]);
  const departmentBaseRows = useMemo(() => buildDepartmentBaseRows(employees), [employees]);
  const filteredEmployeeBaseRows = useMemo(
    () =>
      employees.filter((employee) =>
        matchesSearch(
          [
            employee.finalCode,
            employee.id,
            employee.zk,
            employee.fullName,
            employee.department,
            employee.service,
            employee.contract,
            employee.status,
            employee.kind,
          ],
          searchValue,
        ),
      ),
    [employees, searchValue],
  );
  const filteredDepartmentBaseRows = useMemo(
    () =>
      departmentBaseRows.filter((department) =>
        matchesSearch(
          [
            department.label,
            department.total,
            department.active,
            department.stc,
            department.moi,
            department.mod,
            department.serviceCount,
          ],
          searchValue,
        ),
      ),
    [departmentBaseRows, searchValue],
  );
  const absenceSummary = useMemo(() => buildAbsenceSummary(absenceRoster), [absenceRoster]);
  const contractOptions = useMemo(
    () => [...new Set(employees.map((employee) => String(employee.contract || '').trim()).filter(Boolean))].sort(),
    [employees],
  );
  const departmentOptions = useMemo(
    () => [...new Set(employees.map((employee) => String(employee.department || '').trim()).filter(Boolean))].sort(),
    [employees],
  );
  const serviceOptions = useMemo(
    () => [...new Set(employees.map((employee) => String(employee.service || '').trim()).filter(Boolean))].sort(),
    [employees],
  );
  const filteredServiceOptions = useMemo(() => {
    const selectedDepartment = String(employeeDraft?.department || '').trim().toLowerCase();

    if (!selectedDepartment) {
      return serviceOptions;
    }

    const scopedServices = [
      ...new Set(
        employees
          .filter((employee) => String(employee.department || '').trim().toLowerCase() === selectedDepartment)
          .map((employee) => String(employee.service || '').trim())
          .filter(Boolean),
      ),
    ].sort();

    return scopedServices.length ? scopedServices : serviceOptions;
  }, [employeeDraft?.department, employees, serviceOptions]);
  const payTypeOptions = useMemo(
    () => [...new Set(employees.map((employee) => String(employee.payType || '').trim()).filter(Boolean))].sort(),
    [employees],
  );

  const totalEmployees = Number(selectedDayEffectifRows.length || 0);
  const presentEmployees = Number(selectedSummary?.presentEmployees || 0);
  const absentEmployees = useMemo(
    () => dayRoster.filter((row) => String(row.statusCode || '').toUpperCase() === 'ABS').length,
    [dayRoster],
  );
  const showLateKpi = Boolean(selectedDate) && selectedDate >= getTodayIsoDate();
  const lateEmployees = lateRoster.length;
  const newEmployees = newRoster.length;
  const stcCount = monthlyStcEmployees.length;
  const attendanceRate = totalEmployees ? (presentEmployees / totalEmployees) * 100 : 0;
  const productionMetrics = useMemo(() => {
    const total = productionDayRows.length;
    const present = productionPresentRows.length;
    const absent = productionDayRows.filter(
      (row) => String(row.statusCode || '').toUpperCase() === 'ABS',
    ).length;
    const stc = productionStcRows.length;
    const newEmployees = productionNewRows.length;

    return {
      total,
      present,
      absent,
      stc,
      newEmployees,
      periodLabel: activePeriodLabel,
      presentRate: total ? (present / total) * 100 : 0,
      absentRate: total ? (absent / total) * 100 : 0,
      stcRate: total ? (stc / total) * 100 : 0,
    };
  }, [activePeriodLabel, productionDayRows, productionNewRows, productionPresentRows, productionStcRows]);
  const kpiDetailConfig = useMemo(
    () =>
      activeKpiModal
        ? buildKpiDetailConfig(activeKpiModal, {
            monthlyEffectifEmployees,
            presentRoster,
            absentRoster: absenceRoster,
            lateRoster,
            newRoster,
            stcEmployees: monthlyStcEmployees,
            selectedDate,
            periodLabel: activePeriodLabel,
            totalEmployees,
            presentEmployees,
            absentEmployees,
            lateEmployees,
            newEmployees,
            stcCount,
            locale,
            labels: kpiDetailLabels,
            translate,
          })
        : null,
    [
      activeKpiModal,
      monthlyEffectifEmployees,
      presentRoster,
      absenceRoster,
      lateRoster,
      newRoster,
      monthlyStcEmployees,
      selectedDate,
      activePeriodLabel,
      totalEmployees,
      presentEmployees,
      absentEmployees,
      lateEmployees,
      newEmployees,
      stcCount,
      locale,
      kpiDetailLabels,
      language,
    ],
  );

  useEffect(() => {
    if (!showLateKpi && activeKpiModal === 'late') {
      setActiveKpiModal('');
      setKpiSearchValue('');
    }
  }, [activeKpiModal, showLateKpi]);

  const employeeBaseDetailConfig = useMemo(
    () =>
      activeEmployeeBaseModal
        ? buildEmployeeBaseDetailConfig(activeEmployeeBaseModal, {
            employees,
            activeEmployees,
            stcEmployees,
            labels: employeeBaseDetailLabels,
            translate,
          })
        : null,
    [activeEmployeeBaseModal, activeEmployees, employeeBaseDetailLabels, employees, language, stcEmployees],
  );
  const productionDetailConfig = useMemo(
    () =>
      activeProductionModal
        ? buildProductionDetailConfig(activeProductionModal, {
            productionMetrics,
            productionDayRows,
            productionPresentRows,
            productionNewRows,
            productionStcRows,
            selectedDate,
            locale,
            labels: productionDetailLabels,
            translate,
          })
        : null,
    [
      activeProductionModal,
      productionMetrics,
      productionDayRows,
      productionPresentRows,
      productionNewRows,
      productionStcRows,
      selectedDate,
      locale,
      productionDetailLabels,
      language,
    ],
  );

  const periodRange = availableDates.length
    ? `${formatShortDateLabel(availableDates[0], locale)} ${translate('common.to', 'au')} ${formatShortDateLabel(availableDates[availableDates.length - 1], locale)}`
    : translate('section.noPeriod', 'Aucune periode disponible');
  const latestImportLabel = formatDateTimeLabel(snapshot?.generatedAt, locale);
  const isEmployeeSection = activeSection === 'employees';
  const isDepartmentSection = activeSection === 'departments';
  const isAbsenceSection = activeSection === 'absences';
  const baseServiceCount = useMemo(
    () =>
      new Set(
        employees
          .map((employee) => String(employee.service || '').trim())
          .filter(Boolean),
      ).size,
    [employees],
  );
  const tableTitle = isEmployeeSection
    ? 'BASE RH - EMPLOYES'
    : isDepartmentSection
      ? 'BASE RH - DEPARTEMENTS'
      : isAbsenceSection
        ? 'ABSENCES & CONGES'
      : `${translate('table.pointageTitle', 'POINTAGE DU PERSONNEL')} - ${formatDateLabel(selectedDate, locale)}`;
  const tableSubtitle = isEmployeeSection
    ? `${employees.length} fiche(s) chargee(s) depuis la base RH`
    : isDepartmentSection
      ? `${departmentBaseRows.length} departement(s) resumes depuis la base RH`
      : isAbsenceSection
        ? `${absenceRoster.length} absence(s) et conge(s) detecte(s) pour ${formatDateLabel(selectedDate, locale)}`
      : `${selectedWeek?.title || translate('table.noActiveTable', 'Aucun tableau actif')}${selectedWeek?.weekId ? ` | ${selectedWeek.weekId}` : ''}`;
  const tableSearchPlaceholder = isEmployeeSection
    ? translate('employeeBase.search', 'Rechercher un employe, service, code...')
    : isDepartmentSection
      ? translate('departmentBase.search', 'Rechercher un departement...')
      : isAbsenceSection
        ? translate('absences.search', 'Rechercher une absence ou un conge...')
      : translate('table.search', 'Rechercher...');

  function handleExportEmployeeBase() {
    exportEmployeeBaseWorkbook(employees, departmentBaseRows);
    setStatusMessage(`Export Excel de la base RH genere le 17/08/2026.`);
  }

  async function handleSaveEmployee() {
    if (!employeeDraft) {
      return;
    }

    try {
      setIsEmployeeSaving(true);
      const fallbackCode = getNextEmployeeCodeValue(employees);
      const fallbackZk = getNextZkValue(employees);
      const draftToSave =
        employeeEditorMode === 'create'
          ? {
              ...employeeDraft,
              id: String(employeeDraft.id || '').trim() || fallbackCode,
              finalCode: String(employeeDraft.finalCode || '').trim() || fallbackCode,
              saber: String(employeeDraft.saber || '').trim() || fallbackCode,
              zk: String(employeeDraft.zk || '').trim() || fallbackZk,
            }
          : employeeDraft;
      const result = await saveEmployeeRecord(draftToSave);
      setEmployees(() =>
        Array.isArray(result.employees) ? sortEmployeeRecords(result.employees) : [],
      );
      setStatusMessage(result.message || 'Fiche employe sauvegardee.');
      handleCloseEmployeeEditor();
    } catch (error) {
      setStatusMessage(error.message || 'Sauvegarde employe impossible.');
    } finally {
      setIsEmployeeSaving(false);
    }
  }

  async function handleDeleteEmployee() {
    if (!employeeDraft) {
      return;
    }

    try {
      setIsEmployeeDeleting(true);
      const result = await deleteEmployeeRecord(employeeDraft, employeeDraft.recordId);
      setEmployees(() =>
        Array.isArray(result.employees) ? sortEmployeeRecords(result.employees) : [],
      );
      setStatusMessage(result.message || 'Fiche employe supprimee.');
      handleCloseEmployeeEditor();
    } catch (error) {
      setStatusMessage(error.message || 'Suppression employe impossible.');
    } finally {
      setIsEmployeeDeleting(false);
    }
  }

  return (
    <main className={`rh-shell${sidebarOpen ? ' is-sidebar-open' : ''}`}>
      <div
        className={`rh-overlay${sidebarOpen ? ' is-visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={sidebarOpen ? 'false' : 'true'}
      />

      <Sidebar
        activeSection={activeSection}
        onSelect={handleSelectSection}
        periodLabel={selectedWeek?.weekId || translate('section.noWeek', 'Aucune semaine')}
        periodRange={periodRange}
        latestImportLabel={latestImportLabel}
        sidebarOpen={sidebarOpen}
        items={sidebarItems}
        labels={sidebarLabels}
      />

      <section className="rh-main" dir={languageDirection}>
        <header className="rh-topbar">
          <button
            className={`rh-menu-button${sidebarOpen ? ' is-active' : ''}`}
            type="button"
            aria-label={translate('topbar.menu', 'Menu')}
            onClick={() => setSidebarOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>

          <div className="rh-topbar__actions">
            <LanguageSwitcher
              language={language}
              onChange={setLanguage}
              title={translate('switcher.title', 'Traduction')}
            />

            <label className="rh-topbar__date">
              <span>{translate('topbar.dateSelected', 'Date selectionnee')}</span>
              <select
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                disabled={!availableDates.length}
              >
                {availableDates.length ? null : <option value="">{translate('topbar.noDate', 'Aucune date')}</option>}
                {availableDates.map((date) => (
                  <option key={date} value={date}>
                    {formatShortDateLabel(date, locale)}
                  </option>
                ))}
              </select>
            </label>

            <div className="rh-user-chip">
              <img className="rh-user-chip__avatar" src={rhManagerAvatarUrl} alt={translate('topbar.userRole', 'RH Manager')} />
              <div>
                <strong>{translate('topbar.userRole', 'RH Manager')}</strong>
                <span>{translate('topbar.userCompany', 'MYC Beauty')}</span>
              </div>
            </div>
          </div>
        </header>

        <section className="rh-content">
          {isEmployeeSection ? null : (
            <>
              <div className="rh-hero">
            <div>
              <p className="rh-eyebrow">{translate('hero.eyebrow', 'Pointage quotidien du personnel')}</p>
              <h1>{translate('hero.title', 'TABLEAU DE BORD RH')}</h1>
              <p className="rh-subcopy">
                {translate(
                  'hero.subcopy',
                  'Dashboard alimente par le fichier Excel de pointage. Clique sur un bouton a gauche ou sur une carte pour ouvrir une vraie liste de suivi RH.',
                )}
              </p>
            </div>

            <div className="rh-toolbar">
              <label className="rh-import-button">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleImportFile}
                  disabled={isImporting || isLoading}
                />
                {isImporting ? translate('hero.importing', 'Import en cours...') : translate('hero.importExcel', 'Importer Excel')}
              </label>

              <div className="rh-status-pill">{statusMessage}</div>
            </div>
              </div>

              <section className={`rh-kpi-grid${showLateKpi ? '' : ' rh-kpi-grid--five'}`}>
            <KpiCard
              tone="indigo"
              label={translate('kpi.workforceGlobal', 'Effectif globale')}
              tag={translate('kpi.plant', 'Usine')}
              value={totalEmployees || 0}
              note={activePeriodLabel}
              isActive={activeKpiModal === 'total'}
              onClick={() => handleOpenKpiModal('total')}
            />
            <KpiCard
              tone="green"
              label={translate('kpi.presents', 'Presents')}
              value={presentEmployees}
              note={formatPercent(attendanceRate)}
              isActive={activeKpiModal === 'present'}
              onClick={() => handleOpenKpiModal('present')}
            />
            <KpiCard
              tone="orange"
              label={translate('kpi.absents', 'Absents')}
              value={absentEmployees}
              note={formatPercent(totalEmployees ? (absentEmployees / totalEmployees) * 100 : 0)}
              isActive={activeKpiModal === 'absent'}
              onClick={() => handleOpenKpiModal('absent')}
            />
            {showLateKpi ? (
              <KpiCard
                tone="red"
                label={translate('kpi.late', 'Retards')}
                value={lateEmployees}
                note={formatPercent(presentEmployees ? (lateEmployees / presentEmployees) * 100 : 0)}
                isActive={activeKpiModal === 'late'}
                onClick={() => handleOpenKpiModal('late')}
              />
            ) : null}
            <KpiCard
              tone="slate"
              label={translate('kpi.recruitments', 'Nombre de recrutements')}
              value={newEmployees}
              note=""
              isActive={activeKpiModal === 'new'}
              onClick={() => handleOpenKpiModal('new')}
            />
            <KpiCard
              tone="blue"
              label={translate('kpi.stcMonth', 'STC du mois')}
              value={stcCount}
              note={formatPercent(totalEmployees ? (stcCount / totalEmployees) * 100 : 0)}
              isActive={activeKpiModal === 'stc'}
              onClick={() => handleOpenKpiModal('stc')}
            />
              </section>

              <ProductionFocusSection
                productionMetrics={productionMetrics}
                productionServiceBreakdown={productionServiceBreakdown}
                productionKindBreakdown={productionKindBreakdown}
                activeModalKey={activeProductionModal}
                onOpenModal={handleOpenProductionModal}
                labels={productionLabels}
              />

              <section className="rh-chart-grid">
            <article className="rh-card">
              <div className="rh-card__header">
                <h2>{translate('charts.departmentSplit', 'REPARTITION PAR DEPARTEMENT')}</h2>
              </div>

              <div className="rh-donut-layout">
                <div className="rh-donut" style={{ background: getDonutBackground(departmentSegments) }}>
                  <div className="rh-donut__center">
                    <strong>{presentEmployees}</strong>
                    <span>{translate('charts.total', 'Total')}</span>
                  </div>
                </div>

                <div className="rh-legend">
                  {departmentSegments.length ? (
                    departmentSegments.map((segment) => (
                      <div className="rh-legend__item" key={segment.label}>
                        <span className="rh-legend__dot" style={{ backgroundColor: segment.color }} />
                        <strong>{segment.label}</strong>
                        <span>
                          {segment.count} ({segment.percent.toFixed(0)}%)
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="rh-empty-inline">{translate('charts.noPresence', 'Aucune presence pour cette date.')}</div>
                  )}
                </div>
              </div>
            </article>

            <article className="rh-card">
              <div className="rh-card__header">
                <h2>{translate('charts.personnelStatus', 'STATUT DU PERSONNEL')}</h2>
              </div>

              <div className="rh-bars">
                {[
                  { key: 'present', label: translate('kpi.presents', 'Presents'), value: presentEmployees, tone: 'green' },
                  { key: 'absent', label: translate('kpi.absents', 'Absents'), value: absentEmployees, tone: 'red' },
                  { key: 'new', label: translate('kpi.recruitments', 'Nombre de recrutements'), value: newEmployees, tone: 'slate' },
                  { key: 'stc', label: translate('kpi.stcMonth', 'STC du mois'), value: stcCount, tone: 'blue' },
                ].map((item) => (
                  <button
                    className={`rh-bars__item${activeKpiModal === item.key ? ' is-active' : ''}`}
                    key={item.label}
                    type="button"
                    onClick={() => handleOpenKpiModal(item.key)}
                    aria-label={`${translate('charts.clickToOpen', 'Clique pour ouvrir')} ${item.label}`}
                  >
                    <div className="rh-bars__track">
                      <div
                        className={`rh-bars__fill rh-bars__fill--${item.tone}`}
                        style={{
                          height: `${Math.max(12, totalEmployees ? (item.value / totalEmployees) * 100 : 0)}%`,
                        }}
                      />
                    </div>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                    <small>{translate('charts.clickToOpen', 'Clique pour ouvrir')}</small>
                  </button>
                ))}
              </div>
            </article>

            <article className="rh-card">
              <div className="rh-card__header">
                <h2>{translate('charts.presenceRate', 'TAUX DE PRESENCE')}</h2>
              </div>

              <div className="rh-gauge">
                <div
                  className="rh-gauge__dial"
                  style={{
                    background: `conic-gradient(#14c784 0 ${attendanceRate}%, #edf1f7 ${attendanceRate}% 100%)`,
                  }}
                >
                  <div className="rh-gauge__center">
                    <strong>{formatPercent(attendanceRate)}</strong>
                    <span>{translate('charts.target', 'Objectif : 90%')}</span>
                  </div>
                </div>
              </div>
            </article>
              </section>
            </>
          )}

          {isEmployeeSection || isDepartmentSection || isAbsenceSection ? (
            isEmployeeSection ? (
              <EmployeeBaseSurface
                employees={employees}
                filteredEmployees={filteredEmployeeBaseRows}
                departmentRows={departmentBaseRows}
                searchValue={searchValue}
                onSearchChange={setSearchValue}
                onCreate={handleOpenCreateEmployee}
                onEdit={handleOpenEditEmployee}
                onExport={handleExportEmployeeBase}
                onOpenAll={() => handleOpenEmployeeBaseModal('all')}
                onOpenActive={() => handleOpenEmployeeBaseModal('active')}
                onOpenStc={() => handleOpenEmployeeBaseModal('stc')}
                activeEmployeesCount={activeEmployees.length}
                stcEmployeesCount={stcEmployees.length}
                departmentCount={departmentBaseRows.length}
                labels={employeeBaseLabels}
                translate={translate}
              />
            ) : isAbsenceSection ? (
              <AbsenceSurface
                selectedDate={selectedDate}
                rows={absenceRoster}
                summary={absenceSummary}
                searchValue={searchValue}
                onSearchChange={setSearchValue}
                labels={absenceLabels}
                locale={locale}
                translate={translate}
              />
            ) : (
              <DepartmentBaseSurface
                tableTitle={tableTitle}
                tableSubtitle={tableSubtitle}
                searchValue={searchValue}
                onSearchChange={setSearchValue}
                departmentBaseRows={departmentBaseRows}
                filteredDepartmentBaseRows={filteredDepartmentBaseRows}
                baseServiceCount={baseServiceCount}
                activeEmployeesCount={activeEmployees.length}
                stcEmployeesCount={stcEmployees.length}
                productionMetrics={productionMetrics}
                productionServiceBreakdown={productionServiceBreakdown}
                productionKindBreakdown={productionKindBreakdown}
                activeProductionModal={activeProductionModal}
                onOpenProductionModal={handleOpenProductionModal}
                productionLabels={productionLabels}
                labels={departmentBaseLabels}
              />
            )
          ) : (
            <article className="rh-card rh-card--table">
              <div className="rh-card__header rh-card__header--table">
                <div>
                  <h2>{tableTitle}</h2>
                  <p>{tableSubtitle}</p>
                </div>

                <div className="rh-table-tools">
                  <input
                    type="search"
                    value={searchValue}
                    placeholder={tableSearchPlaceholder}
                    onChange={(event) => setSearchValue(event.target.value)}
                  />
                </div>
              </div>

              <div className="rh-table-wrap">
                <table className="rh-table">
                  <thead>
                    <tr>
                      <th>ID ZK</th>
                      <th>{translate('table.name', 'Nom')}</th>
                      <th>{translate('table.department', 'Departement')}</th>
                      <th>{translate('table.category', 'Categorie')}</th>
                      {selectedWeek?.dayColumns?.map((day) => (
                        <th
                          key={day.isoDate || day.label}
                          className={day.isoDate === selectedDate ? 'is-selected' : ''}
                        >
                          {day.label}
                        </th>
                      ))}
                      <th>{translate('table.standardHours', 'Heures standard')}</th>
                      <th>{translate('table.control', 'Controle')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWeekRows.length ? (
                      filteredWeekRows.map((row) => (
                        <tr key={`${row.employeeKey}-${row.id}`}>
                          <td>{row.id || '-'}</td>
                          <td>{row.fullName || '-'}</td>
                          <td>{row.department || '-'}</td>
                          <td>{row.kind || '-'}</td>
                          {row.days.map((day, index) => (
                            <td
                              key={`${row.employeeKey}-${day.isoDate || index}`}
                              className={day.isoDate === selectedDate ? 'is-selected' : ''}
                            >
                              <span className={`rh-cell-badge rh-cell-badge--${String(day.status || '').toLowerCase()}`}>
                                {day.display || '-'}
                              </span>
                            </td>
                          ))}
                          <td>{row.totalHours || '-'}</td>
                          <td>{row.control || '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="rh-table__empty" colSpan={7 + (selectedWeek?.dayColumns?.length || 0)}>
                          {translate('table.empty', 'Aucun employe a afficher. Importe un fichier Excel pour remplir le tableau.')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          )}
        </section>
      </section>

      {kpiDetailConfig ? (
        <KpiDetailModal
          config={kpiDetailConfig}
          searchValue={kpiSearchValue}
          onSearchChange={setKpiSearchValue}
          onClose={handleCloseKpiModal}
          labels={modalLabels}
          translate={translate}
        />
      ) : null}

      {employeeBaseDetailConfig ? (
        <KpiDetailModal
          config={employeeBaseDetailConfig}
          searchValue={kpiSearchValue}
          onSearchChange={setKpiSearchValue}
          onClose={handleCloseEmployeeBaseModal}
          labels={modalLabels}
          translate={translate}
        />
      ) : null}

      {productionDetailConfig ? (
        <KpiDetailModal
          config={productionDetailConfig}
          searchValue={kpiSearchValue}
          onSearchChange={setKpiSearchValue}
          onClose={handleCloseProductionModal}
          labels={modalLabels}
          translate={translate}
        />
      ) : null}

      {employeeEditorMode !== 'closed' ? (
        <EmployeeEditorModal
          mode={employeeEditorMode}
          draft={employeeDraft}
          deleteCode={deleteCode}
          isSaving={isEmployeeSaving}
          isDeleting={isEmployeeDeleting}
          contractOptions={contractOptions}
          departmentOptions={departmentOptions}
          serviceOptions={filteredServiceOptions}
          payTypeOptions={payTypeOptions}
          onChange={handleEmployeeDraftChange}
          onSave={handleSaveEmployee}
          onDelete={handleDeleteEmployee}
          onDeleteCodeChange={setDeleteCode}
          onClose={handleCloseEmployeeEditor}
          labels={employeeEditorLabels}
          translate={translate}
        />
      ) : null}
    </main>
  );
}
