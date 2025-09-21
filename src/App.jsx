import React, { useState } from 'react';
import { Upload, Calculator, Users, Clock, FileText } from 'lucide-react';

const RecoveryCalculator = () => {
  const [csvData, setCsvData] = useState('');
  const [teachers, setTeachers] = useState([]);
  const [debugLog, setDebugLog] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Definizione moduli orari
  const TIME_MODULES = [
    { numero: 1, start: '08:00', end: '08:50', recovery: 0 },
    { numero: 2, start: '08:50', end: '09:50', recovery: 0 },
    { numero: 3, start: '09:50', end: '10:40', recovery: 10 },
    { numero: 4, start: '10:40', end: '11:30', recovery: 10 },
    { numero: 5, start: '11:30', end: '12:25', recovery: 5 },
    { numero: 6, start: '12:25', end: '13:15', recovery: 0 }
  ];

  // Parser per formato orario "08h50" -> "08:50"
  const parseTime = (timeStr) => {
    if (!timeStr) return null;
    const match = timeStr.match(/(\d{2})h(\d{2})/);
    if (!match) return null;
    return `${match[1]}:${match[2]}`;
  };

  // Parser per durata "2h00" -> numero di moduli
  const parseModuleCount = (durationStr) => {
    if (!durationStr) return 0;
    const match = durationStr.match(/(\d+)h(\d{2})/);
    if (!match) return 0;
    return parseInt(match[1]);
  };

  // Parser per docenti multipli
  const parseTeachers = (cognomi, nomi) => {
    if (!cognomi || !nomi || cognomi.includes('DISPOSIZIONE')) return [];
    
    const cognomiList = cognomi.split(',').map(s => s.trim());
    const nomiList = nomi.split(',').map(s => s.trim());
    
    const teachers = [];
    for (let i = 0; i < Math.max(cognomiList.length, nomiList.length); i++) {
      const cognome = cognomiList[i] || cognomiList[0];
      const nome = nomiList[i] || nomiList[0];
      if (cognome && nome) {
        teachers.push({ cognome, nome, fullName: `${cognome} ${nome}` });
      }
    }
    return teachers;
  };

  // Converti orario in minuti dal midnight
  const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Trova il modulo che contiene un orario specifico
  const findModuleByTime = (timeStr) => {
    const timeMinutes = timeToMinutes(timeStr);
    return TIME_MODULES.find(module => {
      const startMinutes = timeToMinutes(module.start);
      const endMinutes = timeToMinutes(module.end);
      return timeMinutes >= startMinutes && timeMinutes < endMinutes;
    });
  };

  // Calcola quali moduli sono coperti da un'attività
  const getModuliCoperti = (startTime, moduleCount) => {
    const startModule = findModuleByTime(startTime);
    if (!startModule) return [];

    const moduli = [];
    const startIndex = startModule.numero - 1;
    
    for (let i = 0; i < moduleCount && startIndex + i < TIME_MODULES.length; i++) {
      moduli.push(TIME_MODULES[startIndex + i]);
    }

    return moduli;
  };

  // Calcola minuti di recupero per una singola riga
  const calculateRowRecovery = (row) => {
    const startTime = parseTime(row.O_INIZIO);
    const moduleCount = parseModuleCount(row.DURATA);
    
    if (!startTime || !moduleCount) {
      return { recovery: 0, moduli: [], details: 'Orario non valido' };
    }

    const moduli = getModuliCoperti(startTime, moduleCount);
    const recovery = moduli
      .filter(mod => mod.recovery > 0)
      .reduce((sum, mod) => sum + mod.recovery, 0);

    const endTime = moduli.length > 0 ? moduli[moduli.length - 1].end : startTime;

    return {
      recovery,
      moduli,
      details: `${startTime}-${endTime} (${moduleCount} moduli): ${moduli.map(m => `${m.numero}°${m.recovery > 0 ? `(+${m.recovery}min)` : ''}`).join(', ')}`
    };
  };

  // Processa il CSV
  const processCSV = () => {
    setIsProcessing(true);
    setDebugLog([]);
    
    try {
      const lines = csvData.trim().split('\n');
      const headers = lines[0].split(';');
      
      const headerMap = {};
      headers.forEach((header, index) => {
        headerMap[header.trim()] = index;
      });

      const teacherMap = new Map();
      const log = [];

      lines.slice(1).forEach((line, index) => {
        const values = line.split(';');
        if (values.length < headers.length) return;

        const row = {
          NUMERO: values[headerMap['NUMERO']],
          GIORNO: values[headerMap['GIORNO']],
          O_INIZIO: values[headerMap['O.INIZIO']],
          DURATA: values[headerMap['DURATA']],
          DOC_COGN: values[headerMap['DOC_COGN']],
          DOC_NOME: values[headerMap['DOC_NOME']],
          CODOC: values[headerMap['CO-DOC.']] || 'N',
          MATERIA: values[headerMap['MAT_NOME']],
          CLASSE: values[headerMap['CLASSE']]
        };

        if (row.GIORNO !== 'lunedì' && row.GIORNO !== 'mercoledì') return;

        const teachersList = parseTeachers(row.DOC_COGN, row.DOC_NOME);
        if (teachersList.length === 0) return;

        const calculation = calculateRowRecovery(row);
        
        log.push({
          riga: index + 2,
          giorno: row.GIORNO,
          docenti: teachersList.map(t => t.fullName).join(', '),
          attivita: `${row.MATERIA} - ${row.CLASSE}`,
          codocenza: row.CODOC === 'S',
          ...calculation
        });

        teachersList.forEach(teacher => {
          const key = teacher.fullName;
          if (!teacherMap.has(key)) {
            teacherMap.set(key, {
              nome: teacher.fullName,
              cognome: teacher.cognome,
              minutiSettimanali: 0,
              attivita: []
            });
          }

          const teacherData = teacherMap.get(key);
          teacherData.minutiSettimanali += calculation.recovery;
          teacherData.attivita.push({
            giorno: row.GIORNO,
            materia: row.MATERIA,
            classe: row.CLASSE,
            minuti: calculation.recovery,
            codocenza: row.CODOC === 'S',
            dettagli: calculation.details
          });
        });
      });

      const teachersList = Array.from(teacherMap.values()).map(teacher => ({
        ...teacher,
        tesorettoAnnuale: teacher.minutiSettimanali * 30,
        moduliAnnui: Math.round((teacher.minutiSettimanali * 30) / 50), // Moduli da 50 minuti
        minutiUtilizzati: 0,
        saldo: teacher.minutiSettimanali * 30
      })).sort((a, b) => a.cognome.localeCompare(b.cognome));

      setTeachers(teachersList);
      setDebugLog(log);
      
    } catch (error) {
      console.error('Errore nel processare CSV:', error);
      setDebugLog([{ error: error.message }]);
    }
    
    setIsProcessing(false);
  };

  const sampleData = `NUMERO;NOME;DURATA;FREQUENZA;MAT_COD;MAT_NOME;DOC_COGN;DOC_NOME;CLASSE;AULA;PERIODICITÀ;SPECIFICA;CO-DOC.;COEFF.;GIORNO;O.INIZIO;ALUNNI
1;;1h00;S;I048;SCIENZE;Durante;Valentina;1ALS;<Scienze P1>DNA (P1);S;ss;N;60/60;lunedì;08h00;25
4;;2h00;S;I047;FISICA;Castellucci;Francesco;3ALS;<Matematica P1>Infinito (P1);S;ss;N;60/60;lunedì;08h00;23
30;;2h00;S;I044;INFORMATICA;Ghilarducci, Della Pina;Luca, Lidia;5SIA;<Informatica>Tera (P1);S;ss;S;60/60;lunedì;08h00;20
57;;2h00;S;I043;MATEMATICA;Castellucci;Francesco;1CLS;<Matematica P1>Infinito (P1);S;ss;N;60/60;lunedì;09h50;25
330;;2h00;S;I043;MATEMATICA;Castellucci;Francesco;1CLS;<Matematica P1>Tempo (P1);S;ss;N;60/60;mercoledì;10h40;25
329;;1h00;S;I025;INGLESE;Soldati;Laura;1ALS;<Lingue P2>Paris (P2);S;ss;N;60/60;mercoledì;10h40;25`;

  const totalTeachers = teachers.length;
  const totalMinutes = teachers.reduce((sum, t) => sum + t.tesorettoAnnuale, 0);
  const totalModuli = teachers.reduce((sum, t) => sum + t.moduliAnnui, 0);
  const averageMinutes = totalTeachers > 0 ? Math.round(totalMinutes / totalTeachers) : 0;

  // Funzione per esportare i dati in CSV
  const exportToCSV = () => {
    const headers = ['Docente', 'Minuti/Settimana', 'Tesoretto Annuale (min)', 'Moduli Annui (50min)', 'Saldo (min)'];
    
    const csvContent = [
      headers.join(';'),
      ...teachers.map(teacher => [
        teacher.nome,
        teacher.minutiSettimanali,
        teacher.tesorettoAnnuale,
        teacher.moduliAnnui,
        teacher.saldo
      ].join(';'))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `recupero_minuti_docenti_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Calculator className="text-blue-600" />
          Sistema Calcolo Recupero Minuti Docenti
        </h1>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Incolla qui i dati CSV (o usa i dati di esempio):
            </label>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setCsvData(sampleData)}
                className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
              >
                Usa Dati di Esempio
              </button>
              <button
                onClick={() => setCsvData('')}
                className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
              >
                Pulisci
              </button>
            </div>
            <textarea
              value={csvData}
              onChange={(e) => setCsvData(e.target.value)}
              className="w-full h-32 p-3 border border-gray-300 rounded-md font-mono text-sm"
              placeholder="Incolla qui i dati CSV..."
            />
          </div>

          <button
            onClick={processCSV}
            disabled={!csvData.trim() || isProcessing}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Upload size={16} />
            )}
            {isProcessing ? 'Elaborazione...' : 'Calcola Recupero Minuti'}
          </button>
        </div>
      </div>

      {teachers.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="flex items-center gap-2">
                <Users className="text-blue-600" size={20} />
                <span className="text-sm text-gray-600">Docenti</span>
              </div>
              <div className="text-2xl font-bold text-blue-600">{totalTeachers}</div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center gap-2">
                <Clock className="text-green-600" size={20} />
                <span className="text-sm text-gray-600">Tot. Minuti/Anno</span>
              </div>
              <div className="text-2xl font-bold text-green-600">{totalMinutes}</div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="flex items-center gap-2">
                <Calculator className="text-purple-600" size={20} />
                <span className="text-sm text-gray-600">Tot. Moduli/Anno</span>
              </div>
              <div className="text-2xl font-bold text-purple-600">{totalModuli}</div>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="flex items-center gap-2">
                <FileText className="text-orange-600" size={20} />
                <span className="text-sm text-gray-600">Media Min/Docente</span>
              </div>
              <div className="text-2xl font-bold text-orange-600">{averageMinutes}</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Tesoretti Docenti</h2>
              <button
                onClick={exportToCSV}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md flex items-center gap-2 text-sm"
              >
                <FileText size={16} />
                Esporta CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border p-3 text-left">Docente</th>
                    <th className="border p-3 text-right">Min/Settimana</th>
                    <th className="border p-3 text-right">Tesoretto Annuale (min)</th>
                    <th className="border p-3 text-right">Moduli Annui (50min)</th>
                    <th className="border p-3 text-right">Saldo (min)</th>
                    <th className="border p-3 text-center">Dettagli</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((teacher, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="border p-3 font-medium">{teacher.nome}</td>
                      <td className="border p-3 text-right">{teacher.minutiSettimanali}</td>
                      <td className="border p-3 text-right font-bold text-green-600">
                        {teacher.tesorettoAnnuale}
                      </td>
                      <td className="border p-3 text-right font-bold text-purple-600">
                        {teacher.moduliAnnui}
                      </td>
                      <td className="border p-3 text-right">{teacher.saldo}</td>
                      <td className="border p-3 text-center">
                        <details className="cursor-pointer">
                          <summary className="text-blue-600 hover:text-blue-800">
                            {teacher.attivita.length} attività
                          </summary>
                          <div className="mt-2 text-sm text-left">
                            {teacher.attivita.map((att, i) => (
                              <div key={i} className="py-1 border-b last:border-b-0">
                                <div className="font-medium">
                                  {att.giorno}: {att.materia} - {att.classe}
                                  {att.codocenza && <span className="ml-2 px-1 bg-blue-100 text-blue-800 text-xs rounded">CODOC</span>}
                                </div>
                                <div className="text-gray-600">{att.dettagli}</div>
                                <div className="text-green-600 font-medium">{att.minuti} min</div>
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Log Calcoli ({debugLog.length} righe processate)</h2>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 sticky top-0">
                    <th className="border p-2">Riga</th>
                    <th className="border p-2">Giorno</th>
                    <th className="border p-2">Docenti</th>
                    <th className="border p-2">Attività</th>
                    <th className="border p-2">Recupero</th>
                    <th className="border p-2">Dettagli</th>
                  </tr>
                </thead>
                <tbody>
                  {debugLog.map((log, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="border p-2">{log.riga}</td>
                      <td className="border p-2">{log.giorno}</td>
                      <td className="border p-2">
                        {log.docenti}
                        {log.codocenza && <span className="ml-1 text-xs bg-blue-100 text-blue-800 px-1 rounded">CODOC</span>}
                      </td>
                      <td className="border p-2">{log.attivita}</td>
                      <td className="border p-2 text-right font-bold">
                        <span className={log.recovery > 0 ? 'text-green-600' : 'text-gray-400'}>
                          {log.recovery} min
                        </span>
                      </td>
                      <td className="border p-2 text-xs text-gray-600">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default RecoveryCalculator;
