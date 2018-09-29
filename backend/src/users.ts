const rp = require("request-promise-native");
import {
  ServiceManager,
  ServiceTeam,
  GithubManager,
  BitbucketManager
} from "./manager";
import BitbucketService from "./services/bitbucket";
import GithubService from "./services/github";
import * as moment from "moment";
import { IService } from "./services/types";
const jwt = require("jsonwebtoken");

enum Service {
  github = "github",
  bitbucket = "bitbucket"
}

type EmailContext = {
  name: string;
  subject: string;
  chartUrl: string;
  reportLink: string;
};

class Auth0Client {
  managementToken: string | undefined;

  setupToken(): Promise<void> {
    // This sets up the management token for Auth0, allowing us to fetch data from Auth0
    const {
      AUTH0_MANAGER_TOKEN_URL: uri,
      AUTH0_MANAGER_AUDIENCE: audience,
      AUTH0_MANAGER_CLIENT_ID: clientId,
      AUTH0_MANAGER_CLIENT_SECRET: clientSecret
    } = process.env;

    return rp({
      uri,
      method: "POST",
      body: {
        client_id: clientId,
        client_secret: clientSecret,
        audience,
        grant_type: "client_credentials"
      },
      json: true
    }).then(response => {
      this.managementToken = response.access_token;
    });
  }

  async getUser(userId: string) {
    if (!this.managementToken) {
      await this.setupToken();
    }

    const { AUTH0_MANAGER_AUDIENCE: baseUrl } = process.env;
    return rp({
      uri: `${baseUrl}users/${userId}`,
      headers: {
        Authorization: `Bearer ${this.managementToken}`
      },
      json: true
    });
  }
}

export default class UserManager {
  userId: string;
  service: Service;
  auth0Client: Auth0Client | undefined;
  userAccessToken: string | undefined;
  userRefreshToken: string | undefined;
  serviceManager: ServiceManager | undefined;

  constructor(accessToken: string, private accountName?: string) {
    const decoded = jwt.decode(accessToken);
    this.userId = decoded.sub;

    if (this.userId.startsWith("github")) {
      this.service = Service.github;
    } else if (this.userId.startsWith("bitbucket")) {
      this.service = Service.bitbucket;
    }

    this.auth0Client = new Auth0Client();
  }

  async getServiceClient(): Promise<IService> {
    let client;
    await this.setupServiceManager();
    const token = await this.serviceManager.getTeamToken();

    console.log("token", token);

    if (this.service === Service.github) {
      client = new GithubService(token, this.accountName);
    } else if (this.service === Service.bitbucket) {
      client = new BitbucketService(token, this.accountName);
    }

    return client;
  }

  async getServiceTeams(): Promise<ServiceTeam[]> {
    await this.setupServiceManager();
    return this.serviceManager.getTeams();
  }

  private async setupServiceManager() {
    const user = await this.auth0Client.getUser(this.userId);
    const { identities } = user;
    const serviceIdentity = identities.filter(i => i.provider === this.service);
    this.userAccessToken = serviceIdentity[0].access_token;
    this.userRefreshToken = serviceIdentity[0].refresh_token;

    if (this.service === Service.github) {
      this.serviceManager = new GithubManager(
        this.userAccessToken,
        this.userRefreshToken,
        this.accountName
      );
    } else if (this.service === Service.bitbucket) {
      this.serviceManager = new BitbucketManager(
        this.userAccessToken,
        this.userRefreshToken,
        this.accountName
      );
    }
  }

  async getEmailContext(): Promise<EmailContext> {
    const client = await this.getServiceClient();
    const report = await client.emailReport();

    return this.getServiceClient()
      .then(client => client.emailReport())
      .then(report => {
        let weekWiseData = {};
        const { owner, period, repos } = report;
        const { next } = period;
        const { name } = owner;

        repos.forEach(repo => {
          const { stats } = repo;
          const { authors } = stats;
          authors.forEach(authorStats => {
            const { commits } = authorStats;
            commits.forEach(({ week, value }) => {
              if (week in weekWiseData) {
                weekWiseData[week] = value + weekWiseData[week];
              } else {
                weekWiseData[week] = value;
              }
            });
          });
        });

        const keys = Object.keys(weekWiseData).sort();
        const data = keys.map(key => weekWiseData[key]);
        const keysFormatted = keys.map(key =>
          moment.unix(+key).format("MMM D")
        );

        return {
          name,
          subject: `${name}: gitstats for the week of ${next.format("MMM D")}`,
          summaryText: this.getSummaryText(data),
          chartUrl: this.constructChartUrl(data, keysFormatted),
          reportLink: "https://gitstats.report/"
        };
      });
  }

  private getSummaryText(data) {
    const prev = data[data.length - 2];
    const next = data[data.length - 1];
    const diff = (next - prev) / prev;

    if (diff >= 0) {
      return `up by ${Math.round(diff * 100)}%`;
    } else {
      return `down by ${Math.round(-1 * diff * 100)}%`;
    }
  }

  private constructChartUrl(data, xAxis) {
    // "https://image-charts.com/chart?cht=bvs&chd=t%3A200%2C190%2C180%2C290%2C250&chds=a&chof=.png&chs=600x300&chdls=000000&chco=4D89F9%2CC6D9FD&chtt=Commit%20activity&chxt=x%2Cy&chxl=0%3A%7CJan%7CFeb%7CMarch%7CApril%7CMay&chma=10%2C10%2C20&chdlp=b&chf=bg%2Cs%2CFFFFFF&chbh=10&icwt=false";
    const dataString = `t:${data.join(",")}`;
    const axisLabels = `0:|${xAxis.join("|")}`;
    const params = {
      cht: "bvs",
      chd: dataString,
      chds: "a",
      chof: ".png",
      chs: "600x300",
      chdls: "000000",
      chco: "4D89F9,C6D9FD",
      chtt: "Weekly commit activity",
      chxt: "x,y",
      chxl: axisLabels,
      chdlp: "b",
      chf: "bg,s,FFFFFF",
      chbh: "10"
    };
    const query = Object.keys(params)
      .map(k => k + "=" + encodeURIComponent(params[k]))
      .join("&");
    return `https://image-charts.com/chart?${query}`;
  }
}
