// @ts-check
export class MockLMS {
  /** @param {{learnerName?:string}} [opts] */
  constructor(opts = {}) {
    this.persistent = { 'cmi.completion_status':'unknown','cmi.success_status':'unknown','cmi.location':'',
      'cmi.suspend_data':'','cmi.progress_measure':'','cmi.total_time':'PT0H0M0S','cmi.exit':'' };
    // Read-only learner identity supplied by the LMS.
    this.learnerName = opts.learnerName !== undefined ? opts.learnerName : 'Quinn, Darryl';
    this.learnerId = opts.learnerId !== undefined ? opts.learnerId : 'jquinnd1';
    this.launchCount = 0;
  }
  newAttempt() {
    this.launchCount++;
    const suspended = this.persistent['cmi.exit']==='suspend' || !!this.persistent['cmi.suspend_data'];
    const session = { ...this.persistent, 'cmi.entry': suspended?'resume':'ab-initio', 'cmi.exit':'', 'cmi.session_time':'PT0H0M0S',
      'cmi.learner_name': this.learnerName, 'cmi.learner_id': this.learnerId };
    let init=false, err='0'; const self=this;
    const KEYS=['cmi.completion_status','cmi.success_status','cmi.location','cmi.suspend_data','cmi.progress_measure','cmi.exit','cmi.session_time'];
    const RO=new Set(['cmi.entry','cmi.total_time','cmi.learner_name','cmi.learner_id']);
    const api = {
      Initialize(){ init=true; err='0'; return 'true'; },
      Terminate(){ api.Commit(''); init=false; return 'true'; },
      GetValue(el){ if(!init){err='122';return '';} err='0'; return session[el]!==undefined?String(session[el]):''; },
      SetValue(el,v){ if(!init){err='132';return 'false';} if(RO.has(el)){err='404';return 'false';} session[el]=String(v); err='0'; return 'true'; },
      Commit(){ if(!init){err='142';return 'false';} for(const k of KEYS) if(session[k]!==undefined) self.persistent[k]=session[k]; err='0'; return 'true'; },
      GetLastError(){ return err; }, GetErrorString(){ return ''; }, GetDiagnostic(){ return ''; },
    };
    return api;
  }
  snapshot(){ return { ...this.persistent, launchCount:this.launchCount }; }
}
