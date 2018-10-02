import * as React from "react";
import { Container } from "reactstrap";
import { getLabels, getWeek } from "../../utils/date";
import { TeamName } from "../Common";

const ExpandedDateLabel = ({ input }) => {
  const { day, date } = getLabels(input);
  return (
    <span>
      <span className="text-muted">{day}</span>
      {", "}
      <span>{date}</span>
    </span>
  );
};

const RangeLabel = ({ start, end }) => {
  return (
    <div className="h4 my-0">
      <ExpandedDateLabel input={start} />
      <span className="small font-italic text-muted mx-2">to</span>
      <ExpandedDateLabel input={end} />
    </div>
  );
};

interface ITeam {
  name: string;
  avatar: string;
  login: string;
  service: string;
}

interface IHeaderProps {
  weekStart: string;
  team: ITeam;
}

export class Header extends React.Component<IHeaderProps, {}> {
  public render() {
    const { team, weekStart } = this.props;
    return (
      <Container>
        <div className="d-flex justify-content-between align-items-center my-3">
          <TeamName {...team} />
          <RangeLabel {...getWeek(weekStart)} />
        </div>
      </Container>
    );
  }
}