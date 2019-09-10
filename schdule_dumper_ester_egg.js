// ==UserScript==
// @name         Schdule Dumper
// @version      0.1
// @description  A tampermonkey script for dumping your course schdule to .ics file.
// @author       @NuclearMissle
// @include      https://subjregist.naist.jp/registrations/preview_list
// @grant        GM.xmlHttpRequest
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.4.1/jquery.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.24.0/moment.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/rxjs/6.5.3/rxjs.umd.min.js
// @connect      syllabus.naist.jp
// ==/UserScript==

'use strict';
// whether dump the courses which were over cancellation time limit
const DUMP_OUTDATE_FLAG = false;
// true for log viewing
const MYLOG_FLAG = true;
const DOM_PARSER = new DOMParser();
const TARGET_URL = 'https://subjregist.naist.jp/registrations/preview_list';
const TIME_TABLE = {
    '1': { start: '092000', end: '105000' },
    '2': { start: '110000', end: '123000' },
    '3': { start: '133000', end: '150000' },
    '4': { start: '151000', end: '164000' },
    '5': { start: '165000', end: '182000' },
    '6': { start: '183000', end: '200000' },
};
const MAGIC_CODE = [
    "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
    "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
    "KeyB", "KeyA", "KeyB", "KeyA"
];
const INPUT_TIME_LIMIT = 2500;

console.mylog = msg => {
    if (MYLOG_FLAG) {
        console.log('from mylog:');
        console.log(msg);
    }
};

class Subject {
    constructor(subjectName, url) {
        this.subjectName = subjectName;
        this.url = url;
        this.schduleList = [];
    }

    toString() {
        return JSON.stringify(this, '\t');
    }

    toEventStringList() {
        return this.schduleList
            .filter(schdule => moment().isBefore(schdule.start))
            .map(schdule => `BEGIN:VEVENT
DTSTART:${schdule.start}
DTEND:${schdule.end}
DESCRIPTION:${schdule.note}
LOCATION:${schdule.room}
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:${this.subjectName}
TRANSP:OPAQUE
END:VEVENT`);
    }
}

class Schdule {
    constructor() {
        this.number = null;
        this.date = null;
        this.time = null;
        this.room = null;
        this.note = null;
        this.start = null;
        this.end = null;
    }

    toString() {
        return JSON.stringify(this, '\t');
    }
}

function main() {
    if (window.location.href !== TARGET_URL) {
        alert(`Please run this script at ${TARGET_URL}`);
        return;
    }

    let subjectListSelector = DUMP_OUTDATE_FLAG ? 'table.tbl01.mB20 a[target=_blank]'
        : 'table.tbl01.mB20 td:not(.bgGray01) a[target=_blank]';

    let subjectList = $.map($(subjectListSelector), node => new Subject(node.text.trim(), node.href.trim()));

    if (subjectList.length === 0) {
        alert('No subject found.');
        return;
    }
    let msg = `Below ${subjectList.length} subject(s) are found. Dump?
    ${subjectList.flatMap(subject => subject.subjectName).join('\n    ')}`;
    if (!confirm(msg)) {
        return;
    }

    fillSubjects(subjectList).then(subjectList => {
        console.mylog('******Generate iCal file******');
        console.mylog(subjectList);
        let icsString = `BEGIN:VCALENDAR
PRODID:-//Google Inc//Google Calendar 70.9054//EN
VERSION:2.0
X-WR-TIMEZONE:Asia/Tokyo
${subjectList.flatMap(subject => subject.toEventStringList()).join('\n')}
END:VCALENDAR`;
        downloadString(icsString, `dump_${moment().format('YYYYMMDDTHHmmss')}.ics`);
        console.mylog('*******END********');
    }).catch(reason => {
        alert(reason);
    });
}

// entry point
(() => {
    // rxjs.Observable.fromEvent(document, 'keyup')
    //     .map(e => e.code)
    //     .bufferCount(12, 1)
    //     .bufferTime(INPUT_TIME_LIMIT)
    //     .subscribe(bufferedInputs => {
    //         if (_.isEqual(bufferedInputs, MAGIC_CODE)) {
    //             main();
    //         }
    //     });
})();

function formatDate(date) {
    date = date.split('/').map(s => s.length === 1 ? `0${s}` : s).join('');
    return `${moment().year()}${date}`;
}

function fillSubjects(subjectList) {
    console.mylog('******fill subjectLists******');
    let promises = $.map(subjectList, subject =>
        new Promise((res, rej) => {
            GM.xmlHttpRequest({
                method: 'GET',
                url: subject.url,
                onload: resp => {
                    let doc = DOM_PARSER.parseFromString(resp.responseText, "text/html");
                    let trs = $(doc).find("tr:contains('講義室'):contains('備考')~tr");
                    trs = trs.length !== 0 ? trs : $(doc).find("tr:contains('Room'):contains('Note')~tr");
                    for (let tr of trs) {
                        let schdule = new Schdule();
                        schdule.date = formatDate(tr.cells[1].innerHTML.toString().trim());
                        schdule.time = tr.cells[2].innerHTML.toString().trim();
                        schdule.start = `${schdule.date}T${TIME_TABLE[schdule.time].start}`;
                        schdule.end = `${schdule.date}T${TIME_TABLE[schdule.time].end}`;
                        schdule.number = tr.cells[0].innerHTML.toString().trim();
                        schdule.room = tr.cells[3].innerHTML.toString().trim();
                        schdule.note = tr.cells[4].innerHTML.toString().trim() + '(Dumped schedule)';
                        subject.schduleList.push(schdule);
                    }
                    res(subject);
                },
                onerror: resp => {
                    console.warn(resp);
                    rej(`Filed to fetch data for subject: ${subject.name}, please check log for more detail.`);
                },
                ontimeout: resp => {
                    console.warn(resp);
                    rej(`Filed to fetch data for subject: ${subject.name}, please check log for more detail.`);
                },
            });
        }));
    console.mylog('*******END********');
    return Promise.all(promises);
}

function downloadString(stringToSave, fileName) {
    let elemA = document.createElement('a');
    elemA.download = fileName;
    elemA.style.display = 'none';
    let blob = new Blob([stringToSave]);
    elemA.href = URL.createObjectURL(blob);
    document.body.appendChild(elemA);
    elemA.click();
    document.body.removeChild(elemA);
}