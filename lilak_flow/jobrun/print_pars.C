// The parameters a LILAK output keeps (its ParameterContainer), printed one a line: lilak_flow
// compares them with the file's own. root -l -b -q 'print_pars.C("out.root")'
void print_pars(const char *name) {
  TFile f(name);
  auto p = f.IsOpen() ? f.Get("ParameterContainer") : nullptr;
  if (!p) { cout << "LILAK_FLOW_NO_PARAMETERS" << endl; return; }
  p->Print();
}
