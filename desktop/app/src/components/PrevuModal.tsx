import { Modal } from "./Modal";
import { cap, fmtClock, fmtDayLong, fmtKm } from "../lib/format";
import { fmtAllure } from "../lib/nolio";
import type { NolioEvt } from "../repo/types";

/** Le détail d'une séance prévue par le coach : chiffres, effort estimé et mot du coach en entier. Ouvert au clic, jamais affiché d'office. */
export function PrevuModal({ evt, onClose }: { evt: NolioEvt; onClose: () => void }) {
  return (
    <Modal title={evt.titre || "Séance prévue"} subtitle={cap(fmtDayLong(evt.date))} onClose={onClose}>
      <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4">
        <div><b className="block whitespace-nowrap text-xl font-black">{fmtClock(evt.dureeS)}</b><span className="sub">durée</span></div>
        <div><b className="block whitespace-nowrap text-xl font-black">{fmtKm(evt.distanceM)}</b><span className="sub">distance</span></div>
        <div><b className="block whitespace-nowrap text-xl font-black">{fmtAllure(evt.allureSKm)}</b><span className="sub">{evt.allurePlafond ? "allure maximale" : "allure"}</span></div>
        {evt.rpePrevu !== null ? <div><b className="block text-xl font-black">{evt.rpePrevu} / 10</b><span className="sub">effort estimé</span></div> : null}
      </div>
      {evt.allurePlafond ? <p className="sub mb-0 mt-3">Une limite à ne pas dépasser, pas une allure à tenir.</p> : null}
      {evt.commentaire ? (
        <>
          <h3 className="mb-1 mt-4 text-[13px] font-black uppercase">Mot du coach</h3>
          <p className="m-0 whitespace-pre-line">{evt.commentaire}</p>
        </>
      ) : null}
    </Modal>
  );
}
